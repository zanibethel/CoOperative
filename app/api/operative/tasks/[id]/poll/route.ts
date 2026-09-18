import { NextResponse } from "next/server";

import { pollDetachedSandboxTask } from "@/lib/operative/sandbox-adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function tail(value: string, limit = 2500) {
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function isDetachedResult(value: unknown): value is {
  executionMode: "detached";
  sandboxName: string;
  deadlineAt: string;
  playbookKey?: string;
  gitRef?: string;
  startedAt?: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.executionMode === "detached" &&
    typeof record.sandboxName === "string" &&
    typeof record.deadlineAt === "string"
  );
}

export async function GET(
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
      "id, organization_id, status, result, playbook_key, actual_spend_microunits, error",
    )
    .eq("id", id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (["completed", "failed", "cancelled", "rolled_back"].includes(task.status)) {
    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      result: task.result,
      error: task.error,
    });
  }

  if (task.status !== "executing" || !isDetachedResult(task.result)) {
    return NextResponse.json(
      {
        error: "Task is not an active detached execution.",
        status: task.status,
      },
      { status: 409 },
    );
  }

  let poll;
  try {
    poll = await pollDetachedSandboxTask({
      sandboxName: task.result.sandboxName,
      deadlineAt: task.result.deadlineAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to poll detached Sandbox task.";

    if (Date.now() <= Date.parse(task.result.deadlineAt)) {
      return NextResponse.json(
        {
          taskId: task.id,
          status: "executing",
          transientError: message,
        },
        { status: 503 },
      );
    }

    poll = {
      state: "failed" as const,
      sandboxName: task.result.sandboxName,
      durationMs: null,
      steps: [],
      error: "Detached Sandbox became unavailable after its execution deadline.",
    };
  }

  if (poll.state === "running") {
    return NextResponse.json(
      {
        taskId: task.id,
        status: "executing",
        asynchronous: true,
        sandboxName: poll.sandboxName,
      },
      { status: 202 },
    );
  }

  const admin = createAdminClient();
  const compactResult = {
    ...task.result,
    state: poll.state,
    succeeded: poll.state === "succeeded",
    durationMs: poll.durationMs,
    steps: poll.steps.map((step) => ({
      cmd: step.cmd,
      exitCode: step.exitCode,
      stdoutTail: tail(step.stdout),
      stderrTail: tail(step.stderr),
    })),
  };

  if (poll.state === "failed") {
    const { data: claimed, error: claimError } = await admin
      .from("operative_tasks")
      .update({
        status: "failed",
        result: compactResult,
        error: poll.error ?? "Detached Sandbox playbook failed.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", "executing")
      .select("id")
      .maybeSingle();

    if (claimError) {
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    if (!claimed) {
      const { data: current } = await supabase
        .from("operative_tasks")
        .select("status, result, error")
        .eq("id", task.id)
        .single();
      return NextResponse.json({ taskId: task.id, ...current });
    }

    await admin.from("task_events").insert([
      {
        task_id: task.id,
        organization_id: task.organization_id,
        event_type: "sandbox_stopped",
        actor: "system",
        detail: {
          sandboxName: poll.sandboxName,
          durationMs: poll.durationMs,
          succeeded: false,
          executionMode: "detached",
        },
      },
      {
        task_id: task.id,
        organization_id: task.organization_id,
        event_type: "error",
        actor: "system",
        detail: {
          message: poll.error ?? "Detached Sandbox playbook failed.",
          stage: "detached_sandbox_execution",
        },
      },
    ]);

    await admin.from("cost_ledger_entries").insert({
      organization_id: task.organization_id,
      task_id: task.id,
      executor: "vercel-sandbox",
      cost_category: "sandbox-compute",
      amount_microunits: 0,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        "Detached Sandbox execution failed. Direct per-task cash cost recorded as $0; allocated platform/quota cost is tracked separately.",
    });

    return NextResponse.json(
      {
        taskId: task.id,
        status: "failed",
        result: compactResult,
        error: poll.error,
      },
      { status: 500 },
    );
  }

  const { data: verifyingClaim, error: verifyingError } = await admin
    .from("operative_tasks")
    .update({
      status: "verifying",
      result: compactResult,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", task.organization_id)
    .eq("status", "executing")
    .select("id")
    .maybeSingle();

  if (verifyingError) {
    return NextResponse.json({ error: verifyingError.message }, { status: 500 });
  }

  if (!verifyingClaim) {
    const { data: current } = await supabase
      .from("operative_tasks")
      .select("status, result, error")
      .eq("id", task.id)
      .single();
    return NextResponse.json({ taskId: task.id, ...current });
  }

  await admin.from("task_events").insert([
    {
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "sandbox_stopped",
      actor: "system",
      detail: {
        sandboxName: poll.sandboxName,
        durationMs: poll.durationMs,
        succeeded: true,
        executionMode: "detached",
      },
    },
    {
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "executing",
      to_status: "verifying",
      actor: "system",
      detail: { verification: "Detached allow-listed playbook exited successfully." },
    },
  ]);

  await admin.from("cost_ledger_entries").insert({
    organization_id: task.organization_id,
    task_id: task.id,
    executor: "vercel-sandbox",
    cost_category: "sandbox-compute",
    amount_microunits: 0,
    currency: "USD",
    is_marginal_cost: true,
    notes:
      "Detached Sandbox execution completed. Direct per-task cash cost recorded as $0; allocated platform/quota cost is tracked separately.",
  });

  const { error: completeError } = await admin
    .from("operative_tasks")
    .update({
      status: "completed",
      result: compactResult,
      actual_spend_microunits: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", task.organization_id)
    .eq("status", "verifying");

  if (completeError) {
    return NextResponse.json({ error: completeError.message }, { status: 500 });
  }

  await admin.from("task_events").insert({
    task_id: task.id,
    organization_id: task.organization_id,
    event_type: "status_changed",
    from_status: "verifying",
    to_status: "completed",
    actor: "system",
    detail: {
      verification: "Detached Cloud Sandbox task completed successfully.",
      marginalCashCostMicrounits: 0,
    },
  });

  return NextResponse.json({
    taskId: task.id,
    status: "completed",
    result: compactResult,
  });
}
