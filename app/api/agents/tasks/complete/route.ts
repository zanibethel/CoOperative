import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { agentWorkerCanAccessOwner, authorizeAgentWorker } from "@/lib/agents/server";

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
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
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
      .select("id,owner_ref,status,agent_key,repo_key,mode,requested_profile,result,branch_name")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (!agentWorkerCanAccessOwner(authorization, task.owner_ref)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (task.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    const priorResult =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : {};
    const incomingResult =
      body.result && typeof body.result === "object"
        ? (body.result as Record<string, unknown>)
        : {};
    const governance =
      priorResult.governance && typeof priorResult.governance === "object"
        ? (priorResult.governance as Record<string, unknown>)
        : {};
    const ownerAuthoritative = governance.ownerAuthoritative === true;
    const branchName =
      typeof body.branchName === "string" && body.branchName.trim()
        ? body.branchName.trim().slice(0, 240)
        : typeof task.branch_name === "string"
          ? task.branch_name
          : null;

    const result: Record<string, unknown> = {
      ...priorResult,
      ...incomingResult,
    };

    if (
      branchName?.startsWith("sandbox/") &&
      task.mode === "prepare_change"
    ) {
      result.sandbox = {
        ...(priorResult.sandbox && typeof priorResult.sandbox === "object"
          ? (priorResult.sandbox as Record<string, unknown>)
          : {}),
        ...(incomingResult.sandbox && typeof incomingResult.sandbox === "object"
          ? (incomingResult.sandbox as Record<string, unknown>)
          : {}),
        branchName,
        mergeAllowed: false,
        promotionState:
          status === "needs_approval"
            ? ownerAuthoritative
              ? "owner-authoritative-tested"
              : "awaiting_owner_review"
            : "testing",
        ownerReviewRequired: !ownerAuthoritative,
        reviewCadenceDays: 7,
      };
    }

    const shouldSuggestStrongerModel =
      status === "failed" &&
      task.mode === "prepare_change" &&
      (task.agent_key === "repo-engineer" || task.agent_key === "debugger");

    if (shouldSuggestStrongerModel) {
      result.strongerModelRecommendation = {
        recommended: true,
        currentProfile: task.requested_profile,
        nextStep:
          task.requested_profile === "quality"
            ? "offer-paid-high-capability-coding-model"
            : "retry-local-quality-first",
        requiresUserApproval:
          task.requested_profile === "quality",
        reason:
          "The lower-cost coding path did not produce a verified safe change. Escalation should be explicit rather than automatic.",
      };
    }

    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result,
      error: typeof body.error === "string" ? body.error.slice(0, 4000) : null,
    };
    if (branchName) {
      update.branch_name = branchName;
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

    if (branchName?.startsWith("sandbox/") && status === "needs_approval") {
      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: task.owner_ref,
        kind: ownerAuthoritative
          ? "owner_authoritative_branch_tested"
          : "owner_branch_review_needed",
        message: ownerAuthoritative
          ? "Owner-authoritative branch passed into the tested state. It may intentionally change defaults; merge remains a separate explicit action."
          : "A sandbox branch is ready for testing and owner review. Merge remains blocked until explicit owner review.",
        metadata: {
          branchName,
          repoKey: task.repo_key,
          reviewCadenceDays: 7,
          mergeAllowed: false,
          ownerAuthoritative,
        },
      });
    }

    if (shouldSuggestStrongerModel) {
      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: task.owner_ref,
        kind: "stronger_model_recommended",
        message:
          task.requested_profile === "quality"
            ? "The quality coding model struggled; a stronger paid coding model can be offered with explicit approval."
            : "The fast coding model struggled; retry with local Quality before considering paid escalation.",
        metadata: result.strongerModelRecommendation,
      });
    }

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete agent task.";
    return NextResponse.json(
      { error: "Could not complete agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
