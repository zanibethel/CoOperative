import { NextResponse } from "next/server";

import { getCloudPlaybook } from "@/lib/operative/playbook-registry";
import { runSandboxTask } from "@/lib/operative/sandbox-adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

function adminUnavailable(error: unknown) {
  return error instanceof Error && error.message.includes("Missing server-only Supabase configuration");
}

function tail(value: string, limit = 2500) {
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: task, error: taskError } = await supabase
    .from("operative_tasks")
    .select(
      "id, organization_id, status, playbook_key, requires_owner_approval, max_spend_microunits",
    )
    .eq("id", id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!["queued", "awaiting_approval"].includes(task.status)) {
    return NextResponse.json(
      { error: "Task is not in an executable state.", status: task.status },
      { status: 409 },
    );
  }

  const playbook = getCloudPlaybook(task.playbook_key);
  if (!playbook) {
    return NextResponse.json(
      { error: "Task does not reference an approved executable playbook.", code: "PLAYBOOK_REQUIRED" },
      { status: 409 },
    );
  }

  if (task.requires_owner_approval) {
    const { data: decision, error: decisionError } = await supabase
      .from("decisions")
      .select("id, status")
      .eq("task_id", task.id)
      .eq("status", "approved")
      .order("resolved_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (decisionError) {
      return NextResponse.json({ error: decisionError.message }, { status: 500 });
    }

    if (!decision) {
      return NextResponse.json(
        { error: "Owner approval is still required.", code: "OWNER_APPROVAL_REQUIRED" },
        { status: 409 },
      );
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (adminUnavailable(error)) {
      return NextResponse.json(
        {
          error: "Trusted Cloud Operative writes are not configured yet.",
          code: "SERVER_SECRET_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }
    throw error;
  }

  const fromStatus = task.status;

  const { data: claimed, error: claimError } = await admin
    .from("operative_tasks")
    .update({
      status: "executing",
      selected_executor: "hermes-cloud-operative",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", task.organization_id)
    .eq("status", fromStatus)
    .select("id")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  if (!claimed) {
    return NextResponse.json(
      { error: "Task was claimed or changed by another executor.", code: "TASK_CONFLICT" },
      { status: 409 },
    );
  }

  await admin.from("task_events").insert([
    {
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "executor_selected",
      actor: "system",
      detail: {
        executor: "hermes-cloud-operative",
        runtime: "vercel-sandbox",
        playbookKey: playbook.key,
        marginalCashCostMicrounits: 0,
      },
    },
    {
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: fromStatus,
      to_status: "executing",
      actor: "system",
      detail: { playbookKey: playbook.key },
    },
  ]);

  const gitRef = process.env.VERCEL_GIT_COMMIT_SHA || "cloud-operative-bootstrap";

  try {
    const result = await runSandboxTask({
      taskId: task.id,
      repoSlug: playbook.repoSlug,
      gitRef,
      commands: playbook.buildCommands(),
      timeoutMs: 4 * 60 * 1000,
    });

    const compactResult = {
      playbookKey: playbook.key,
      gitRef,
      sandboxName: result.sandboxName,
      succeeded: result.succeeded,
      durationMs: result.durationMs,
      steps: result.steps.map((step) => ({
        cmd: step.cmd,
        exitCode: step.exitCode,
        stdoutTail: tail(step.stdout),
        stderrTail: tail(step.stderr),
      })),
    };

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "sandbox_stopped",
      actor: "system",
      detail: {
        sandboxName: result.sandboxName,
        durationMs: result.durationMs,
        succeeded: result.succeeded,
      },
    });

    await admin.from("cost_ledger_entries").insert({
      organization_id: task.organization_id,
      task_id: task.id,
      executor: "vercel-sandbox",
      cost_category: "sandbox-compute",
      amount_microunits: 0,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        "Bootstrap self-check recorded at $0 marginal cash cost while using included Vercel Sandbox quota; runtime " +
        result.durationMs +
        "ms.",
    });

    if (!result.succeeded) {
      await admin
        .from("operative_tasks")
        .update({
          status: "failed",
          result: compactResult,
          error: "One or more allow-listed playbook commands failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", task.organization_id);

      await admin.from("task_events").insert({
        task_id: task.id,
        organization_id: task.organization_id,
        event_type: "error",
        actor: "system",
        detail: { message: "Cloud self-check failed.", result: compactResult },
      });

      return NextResponse.json({ taskId: task.id, result: compactResult }, { status: 500 });
    }

    await admin
      .from("operative_tasks")
      .update({
        status: "verifying",
        result: compactResult,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id);

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "executing",
      to_status: "verifying",
      actor: "system",
      detail: { verification: "all allow-listed commands exited 0" },
    });

    await admin
      .from("operative_tasks")
      .update({
        status: "completed",
        result: compactResult,
        actual_spend_microunits: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id);

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "verifying",
      to_status: "completed",
      actor: "system",
      detail: {
        verification: "Cloud Sandbox task completed successfully.",
        marginalCashCostMicrounits: 0,
      },
    });

    return NextResponse.json({
      taskId: task.id,
      status: "completed",
      result: compactResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloud Sandbox execution failed.";

    await admin
      .from("operative_tasks")
      .update({
        status: "failed",
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id);

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "error",
      actor: "system",
      detail: { message, stage: "sandbox_execution" },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
