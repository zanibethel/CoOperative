import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { localWorkerAuthorized } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  taskId?: unknown;
  status?: unknown;
  result?: unknown;
  error?: unknown;
  branchName?: unknown;
};

const terminalStatuses = new Set(["completed","needs_approval","failed"]);

export async function POST(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!taskId || !terminalStatuses.has(status)) {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data: task, error: taskError } = await admin
      .from("agent_tasks")
      .select("id,owner_ref,status")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (task.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: body.result && typeof body.result === "object" ? body.result : null,
      error: typeof body.error === "string" ? body.error.slice(0, 4000) : null,
    };
    if (typeof body.branchName === "string" && body.branchName.trim()) {
      update.branch_name = body.branchName.trim().slice(0, 240);
    }

    const { error } = await admin.from("agent_tasks").update(update).eq("id", taskId);
    if (error) throw error;

    await admin.from("agent_task_events").insert({
      task_id: taskId,
      owner_ref: task.owner_ref,
      kind: status,
      message:
        status === "failed"
          ? "Agent task failed."
          : status === "needs_approval"
            ? "Prepared change is ready for human review."
            : "Agent task completed.",
      metadata: update.result,
    });

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete agent task.";
    return NextResponse.json(
      { error: "Could not complete agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
