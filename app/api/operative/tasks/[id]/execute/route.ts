import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { reviewCompatibilityKnowledge } from "@/lib/operative/compatibility-review";
import { getCloudPlaybook } from "@/lib/operative/playbook-registry";
import { runSandboxTask, startDetachedSandboxTask } from "@/lib/operative/sandbox-adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hermesRuntimeWorkflow } from "@/lib/workflow/hermes-runtime";
import { hermesModelSmokeWorkflow } from "@/lib/workflow/hermes-model-smoke";

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

  const compatibilityReview = reviewCompatibilityKnowledge(playbook.compatibilityTargets);
  if (!compatibilityReview.ok) {
    return NextResponse.json(
      {
        error: "Compatibility knowledge review is required before this playbook may execute.",
        code: "COMPATIBILITY_REVIEW_REQUIRED",
        uncoveredTargets: compatibilityReview.uncoveredTargets,
      },
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

  const { error: compatibilityEventError } = await admin.from("task_events").insert({
    task_id: task.id,
    organization_id: task.organization_id,
    event_type: "note",
    actor: "system",
    detail: {
      type: "compatibility_review",
      playbookKey: playbook.key,
      targets: compatibilityReview.targets,
      ruleIds: compatibilityReview.ruleIds,
      uncoveredTargets: compatibilityReview.uncoveredTargets,
      outcome: "passed",
    },
  });

  if (compatibilityEventError) {
    return NextResponse.json({ error: compatibilityEventError.message }, { status: 500 });
  }

  const fromStatus = task.status;
  let executionFromStatus = fromStatus;

  if (fromStatus === "queued") {
    const { data: planningClaim, error: planningClaimError } = await admin
      .from("operative_tasks")
      .update({
        status: "planning",
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (planningClaimError) {
      return NextResponse.json({ error: planningClaimError.message }, { status: 500 });
    }

    if (!planningClaim) {
      return NextResponse.json(
        { error: "Task was claimed or changed by another executor.", code: "TASK_CONFLICT" },
        { status: 409 },
      );
    }

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "queued",
      to_status: "planning",
      actor: "system",
      detail: { playbookKey: playbook.key },
    });

    executionFromStatus = "planning";
  }

  const { data: claimed, error: claimError } = await admin
    .from("operative_tasks")
    .update({
      status: "executing",
      selected_executor: playbook.executor,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", task.organization_id)
    .eq("status", executionFromStatus)
    .select("id")
    .maybeSingle();

  if (claimError) {
    const message = "Executor selection failed: " + claimError.message;

    await admin
      .from("operative_tasks")
      .update({
        status: "failed",
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", executionFromStatus);

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "error",
      actor: "system",
      detail: {
        stage: "executor_selection",
        executor: playbook.executor,
        message,
      },
    });

    return NextResponse.json({ error: message }, { status: 500 });
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
        executor: playbook.executor,
        runtime:
          playbook.key === "hermes-model-smoke"
            ? "vercel-workflow+vercel-sandbox+ai-gateway"
            : playbook.executionMode === "workflow"
              ? "vercel-workflow+vercel-sandbox"
              : "vercel-sandbox",
        playbookKey: playbook.key,
        compatibilityRuleIds: compatibilityReview.ruleIds,
        marginalCashCostMicrounits: 0,
      },
    },
    {
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: executionFromStatus,
      to_status: "executing",
      actor: "system",
      detail: { playbookKey: playbook.key },
    },
  ]);

  const gitRef = process.env.VERCEL_GIT_COMMIT_SHA || "cloud-operative-bootstrap";

  try {
    if (playbook.executionMode === "workflow") {
      const startedAt = new Date().toISOString();

      const { error: initialResultError } = await admin
        .from("operative_tasks")
        .update({
          result: {
            playbookKey: playbook.key,
            executionMode: "workflow",
            compatibilityReview: {
              targets: compatibilityReview.targets,
              ruleIds: compatibilityReview.ruleIds,
            },
            progress: {
              stage: "starting_workflow",
              at: startedAt,
            },
          },
          updated_at: startedAt,
        })
        .eq("id", task.id)
        .eq("organization_id", task.organization_id)
        .eq("status", "executing");

      if (initialResultError) {
        throw initialResultError;
      }

      const run =
        playbook.key === "hermes-model-smoke"
          ? await start(hermesModelSmokeWorkflow, [
              {
                taskId: task.id,
                organizationId: task.organization_id,
                maxSpendMicrounits: Number(task.max_spend_microunits ?? 0),
                compatibilityReview: {
                  ruleIds: compatibilityReview.ruleIds,
                  brief: compatibilityReview.brief,
                },
              },
            ])
          : await start(hermesRuntimeWorkflow, [
              {
                taskId: task.id,
                organizationId: task.organization_id,
              },
            ]);

      const { data: currentTask, error: currentTaskError } = await admin
        .from("operative_tasks")
        .select("result")
        .eq("id", task.id)
        .eq("organization_id", task.organization_id)
        .single();

      if (currentTaskError) {
        throw currentTaskError;
      }

      const currentResult =
        currentTask.result &&
        typeof currentTask.result === "object" &&
        !Array.isArray(currentTask.result)
          ? currentTask.result
          : {};

      const workflowResult = {
        ...currentResult,
        playbookKey: playbook.key,
        executionMode: "workflow",
        workflowRunId: run.runId,
      };

      const { error: persistWorkflowError } = await admin
        .from("operative_tasks")
        .update({
          result: workflowResult,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", task.organization_id);

      if (persistWorkflowError) {
        throw persistWorkflowError;
      }

      await admin.from("task_events").insert({
        task_id: task.id,
        organization_id: task.organization_id,
        event_type: "note",
        actor: "system",
        detail: {
          type: "workflow_started",
          workflowRunId: run.runId,
          playbookKey: playbook.key,
        },
      });

      return NextResponse.json(
        {
          taskId: task.id,
          status: "executing",
          asynchronous: true,
          workflowRunId: run.runId,
          result: workflowResult,
        },
        { status: 202 },
      );
    }

    if (playbook.executionMode === "detached") {
      const detached = await startDetachedSandboxTask({
        taskId: task.id,
        repoSlug: playbook.repoSlug,
        gitRef,
        commands: playbook.buildCommands(),
        timeoutMs: 10 * 60 * 1000,
      });

      const detachedResult = {
        playbookKey: playbook.key,
        gitRef,
        executionMode: "detached",
        state: "running",
        sandboxName: detached.sandboxName,
        startedAt: detached.startedAt,
        deadlineAt: detached.deadlineAt,
        compatibilityReview: {
          targets: compatibilityReview.targets,
          ruleIds: compatibilityReview.ruleIds,
        },
      };

      const { error: persistDetachedError } = await admin
        .from("operative_tasks")
        .update({
          result: detachedResult,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", task.organization_id)
        .eq("status", "executing");

      if (persistDetachedError) {
        throw persistDetachedError;
      }

      await admin.from("task_events").insert({
        task_id: task.id,
        organization_id: task.organization_id,
        event_type: "sandbox_created",
        actor: "system",
        detail: {
          sandboxName: detached.sandboxName,
          executionMode: "detached",
          playbookKey: playbook.key,
          deadlineAt: detached.deadlineAt,
        },
      });

      return NextResponse.json(
        {
          taskId: task.id,
          status: "executing",
          asynchronous: true,
          result: detachedResult,
        },
        { status: 202 },
      );
    }

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
      compatibilityReview: {
        targets: compatibilityReview.targets,
        ruleIds: compatibilityReview.ruleIds,
      },
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
        "Bootstrap self-check recorded at $0 direct per-task marginal cash cost in the CoOperative ledger; allocated platform/quota cost should be reconciled separately. Runtime " +
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
