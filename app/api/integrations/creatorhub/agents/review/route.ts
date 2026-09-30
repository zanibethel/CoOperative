import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  userId: z.string().min(1).max(200),
  creatorId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: z.enum(["approve", "deny", "explain"]),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function ownerRef(userId: string, creatorId: string) {
  return `creatorhub:${userId}:${creatorId}`;
}

function reviewPayload(task: {
  branch_name?: string | null;
  result?: Record<string, unknown> | null;
}) {
  const result = task.result || {};
  return {
    branchName: task.branch_name || null,
    summary: typeof result.summary === "string" ? result.summary : null,
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [],
    checksPassed:
      typeof result.checksPassed === "boolean" ? result.checksPassed : null,
    checks: Array.isArray(result.checks) ? result.checks : [],
    diffStat: typeof result.diffStat === "string" ? result.diffStat : "",
    diff: typeof result.diff === "string" ? result.diff : "",
    repository: typeof result.repository === "string" ? result.repository : null,
    model: typeof result.model === "string" ? result.model : null,
    profile: typeof result.profile === "string" ? result.profile : null,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const owner = ownerRef(input.userId, input.creatorId);
    const admin = createAdminSupabaseClient();

    const { data: task, error } = await admin
      .from("agent_tasks")
      .select("id,owner_ref,status,objective,branch_name,result,repo_key")
      .eq("id", input.taskId)
      .eq("owner_ref", owner)
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      return NextResponse.json({ error: "Agent proposal not found." }, { status: 404 });
    }
    if (task.status !== "needs_approval") {
      return NextResponse.json(
        { error: `Proposal is not awaiting review (status: ${task.status}).` },
        { status: 409 },
      );
    }

    const review = reviewPayload(task);

    if (input.action === "approve") {
      const reviewedAt = new Date().toISOString();
      const nextResult = {
        ...(task.result && typeof task.result === "object" ? task.result : {}),
        reviewDecision: "approved",
        reviewedAt,
      };

      const { error: updateError } = await admin
        .from("agent_tasks")
        .update({
          status: "completed",
          result: nextResult,
          updated_at: reviewedAt,
          completed_at: reviewedAt,
        })
        .eq("id", task.id)
        .eq("owner_ref", owner);
      if (updateError) throw updateError;

      await admin.from("agent_task_events").insert({
        task_id: task.id,
        owner_ref: owner,
        kind: "approved",
        message: "Human approved the prepared proposal. Branch remains isolated and unpushed.",
        metadata: { branchName: task.branch_name, source: "creatorhub-chat" },
      });

      return NextResponse.json({
        mode: "review",
        decision: "approved",
        text: `Approved. The proposal remains isolated on ${task.branch_name || "its agent branch"}. Nothing was pushed, merged, or deployed.`,
        review,
      });
    }

    if (input.action === "deny") {
      const reviewedAt = new Date().toISOString();
      const nextResult = {
        ...(task.result && typeof task.result === "object" ? task.result : {}),
        reviewDecision: "denied",
        reviewedAt,
      };

      const { error: updateError } = await admin
        .from("agent_tasks")
        .update({
          status: "cancelled",
          result: nextResult,
          updated_at: reviewedAt,
          completed_at: reviewedAt,
        })
        .eq("id", task.id)
        .eq("owner_ref", owner);
      if (updateError) throw updateError;

      await admin.from("agent_task_events").insert({
        task_id: task.id,
        owner_ref: owner,
        kind: "denied",
        message: "Human denied the prepared proposal. Nothing was pushed or deployed.",
        metadata: { branchName: task.branch_name, source: "creatorhub-chat" },
      });

      return NextResponse.json({
        mode: "review",
        decision: "denied",
        text: "Denied. The proposal will not be treated as approved, and nothing was pushed, merged, or deployed.",
        review,
      });
    }

    const diff = review.diff.slice(0, 22000);
    const checks = JSON.stringify(review.checks).slice(0, 7000);
    const jobId = crypto.randomUUID();
    const messages = [
      {
        role: "system" as const,
        content: [
          "You are reviewing a proposed repository change for a human owner.",
          "Use only the supplied objective, diff, changed files, branch, and deterministic check results.",
          "Give a thorough but readable review: what changed, why it appears to have been changed, whether it matches the objective, risks/regressions, what the checks do and do not prove, suspicious or unrelated edits, and what the owner should verify before approving.",
          "Do not claim the change is correct merely because checks passed. Do not approve, push, merge, or deploy anything.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: [
          `OBJECTIVE:\n${String(task.objective || "").slice(0, 8000)}`,
          `REPOSITORY: ${review.repository || task.repo_key}`,
          `PROPOSAL BRANCH: ${review.branchName || "unknown"}`,
          `SUMMARY: ${review.summary || "none"}`,
          `CHANGED FILES: ${JSON.stringify(review.changedFiles)}`,
          `CHECKS: ${checks}`,
          `DIFF STAT:\n${review.diffStat.slice(0, 4000)}`,
          `DIFF:\n${diff}`,
        ].join("\n\n").slice(0, 32000),
      },
    ];

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: owner,
      messages,
      attachment_ids: [],
      capability: "text",
      profile: "quality",
      max_tokens: 1800,
      temperature: 0.15,
      routing_mode: "local-quality",
      task_class: "verification",
      route_reason: "Human requested a thorough explanation of an agent proposal and diff.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
    });
    if (jobError) throw jobError;

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: owner,
      kind: "explanation_requested",
      message: "Human requested a detailed Local Quality review of the proposal and diff.",
      metadata: { jobId, source: "creatorhub-chat" },
    });

    return NextResponse.json(
      {
        mode: "local-quality",
        jobId,
        status: "queued",
        text: "Local Quality is reviewing the full proposal and diff.",
        review,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not review agent proposal.";
    return NextResponse.json(
      { error: "Could not review agent proposal.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
