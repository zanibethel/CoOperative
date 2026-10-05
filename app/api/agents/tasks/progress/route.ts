import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { agentWorkerCanAccessOwner, authorizeAgentWorker } from "@/lib/agents/server";

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
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
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
      .select("id,owner_ref,status,repo_key,mode,branch_name,result")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (!agentWorkerCanAccessOwner(authorization, task.owner_ref)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

    const branchName =
      typeof body.branchName === "string" && body.branchName.trim()
        ? body.branchName.trim().slice(0, 240)
        : null;
    const sandboxBranchCreated =
      Boolean(branchName?.startsWith("sandbox/")) &&
      task.branch_name !== branchName;

    if (branchName) {
      update.branch_name = branchName;

      if (branchName.startsWith("sandbox/")) {
        const priorResult =
          task.result && typeof task.result === "object"
            ? (task.result as Record<string, unknown>)
            : {};
        const priorSandbox =
          priorResult.sandbox && typeof priorResult.sandbox === "object"
            ? (priorResult.sandbox as Record<string, unknown>)
            : {};
        update.result = {
          ...priorResult,
          sandbox: {
            ...priorSandbox,
            branchName,
            promotionState: "testing",
            mergeAllowed: false,
            ownerReviewRequired: true,
            reviewCadenceDays: 7,
          },
        };
      }
    }
    await admin.from("agent_tasks").update(update).eq("id", taskId);

    if (sandboxBranchCreated) {
      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: task.owner_ref,
        kind: "owner_branch_created",
        message:
          "A new sandbox code branch was created for user testing. It cannot merge until owner review.",
        metadata: {
          branchName,
          repoKey: task.repo_key,
          mode: task.mode,
          mergeAllowed: false,
          reviewCadenceDays: 7,
        },
      });
    }

    return NextResponse.json({ ok: true, cancelled: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not update agent task.";
    return NextResponse.json(
      { error: "Could not update agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
