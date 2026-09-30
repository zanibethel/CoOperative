import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { localWorkerAuthorized } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  taskId?: unknown;
  kind?: unknown;
  message?: unknown;
  metadata?: unknown;
  status?: unknown;
  branchName?: unknown;
};

const allowedStatuses = new Set(["running","waiting_llm","needs_approval"]);

export async function POST(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const kind = typeof body.kind === "string" ? body.kind.trim().slice(0, 80) : "progress";
    if (!taskId || !message) {
      return NextResponse.json({ error: "taskId and message are required." }, { status: 400 });
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
      return NextResponse.json({ ok: true, cancelled: true });
    }

    await admin.from("agent_task_events").insert({
      task_id: taskId,
      owner_ref: task.owner_ref,
      kind,
      message: message.slice(0, 3000),
      metadata:
        body.metadata && typeof body.metadata === "object" ? body.metadata : null,
    });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.status === "string" && allowedStatuses.has(body.status)) {
      update.status = body.status;
    }
    if (typeof body.branchName === "string" && body.branchName.trim()) {
      update.branch_name = body.branchName.trim().slice(0, 240);
    }
    await admin.from("agent_tasks").update(update).eq("id", taskId);

    return NextResponse.json({ ok: true, cancelled: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not update agent task.";
    return NextResponse.json(
      { error: "Could not update agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
