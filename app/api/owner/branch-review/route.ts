import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const reviewSchema = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(["keep-testing", "approve-for-merge", "reject"]),
  note: z.string().max(2000).optional(),
});

async function ownerContext() {
  const userId = await authenticatedUserId();
  if (!userId) return null;

  const admin = createAdminSupabaseClient();
  const { data: owner, error } = await admin
    .from("unison_platform_owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return owner ? { userId } : null;
}

function resultObject(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function sandboxObject(result: Record<string, unknown>) {
  return result.sandbox && typeof result.sandbox === "object"
    ? (result.sandbox as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function candidateFromTask(task: Record<string, unknown>) {
  const result = resultObject(task.result);
  const sandbox = sandboxObject(result);
  const governance =
    result.governance && typeof result.governance === "object"
      ? (result.governance as Record<string, unknown>)
      : {};
  return {
    taskId: String(task.id || ""),
    repoKey: String(task.repo_key || ""),
    branchName: String(task.branch_name || ""),
    status: String(task.status || ""),
    objective:
      typeof task.objective === "string" ? task.objective.slice(0, 1600) : "",
    summary:
      typeof result.summary === "string" ? result.summary.slice(0, 1600) : "",
    changedFiles: stringArray(result.changedFiles).slice(0, 30),
    checksPassed: result.checksPassed === true,
    diffStat:
      typeof result.diffStat === "string" ? result.diffStat.slice(0, 1800) : "",
    model: typeof result.model === "string" ? result.model : null,
    provider: typeof result.provider === "string" ? result.provider : null,
    executor: typeof result.executor === "string" ? result.executor : null,
    commitSha:
      typeof sandbox.commitSha === "string" ? sandbox.commitSha : null,
    pushed: sandbox.pushed === true,
    continued: sandbox.continued === true,
    baseBranch:
      typeof sandbox.baseBranch === "string" ? sandbox.baseBranch : null,
    promotionState:
      typeof sandbox.promotionState === "string"
        ? sandbox.promotionState
        : "testing",
    scope:
      typeof sandbox.scope === "string" ? sandbox.scope : "code-fix",
    uiDefaultFlowPreservedRequired:
      sandbox.uiDefaultFlowPreservedRequired === true,
    userInvokedCapability: sandbox.userInvokedCapability === true,
    ownerAuthoritative: governance.ownerAuthoritative === true,
    governanceAuthority:
      typeof governance.authority === "string"
        ? governance.authority
        : "standard-user",
    mergeAllowed: sandbox.mergeAllowed === true,
    createdAt: task.created_at || null,
    updatedAt: task.updated_at || null,
    completedAt: task.completed_at || null,
  };
}

function overlapScore(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export async function GET() {
  try {
    const owner = await ownerContext();
    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("agent_tasks")
      .select(
        "id,repo_key,mode,status,branch_name,objective,result,error,created_at,updated_at,completed_at",
      )
      .eq("repo_key", "cooperative")
      .eq("mode", "prepare_change")
      .not("branch_name", "is", null)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const candidates = (data || [])
      .filter(
        (task) =>
          typeof task.branch_name === "string" &&
          task.branch_name.startsWith("sandbox/"),
      )
      .map((task) => candidateFromTask(task as unknown as Record<string, unknown>));

    const competingGroups: Array<{
      branches: string[];
      taskIds: string[];
      sharedFiles: string[];
    }> = [];
    const grouped = new Set<string>();

    for (let i = 0; i < candidates.length; i += 1) {
      const base = candidates[i];
      if (grouped.has(base.taskId)) continue;

      const related = [base];
      for (let j = i + 1; j < candidates.length; j += 1) {
        const other = candidates[j];
        if (
          base.repoKey === other.repoKey &&
          overlapScore(base.changedFiles, other.changedFiles) >= 0.34
        ) {
          related.push(other);
        }
      }

      if (related.length > 1) {
        related.forEach((item) => grouped.add(item.taskId));
        const counts = new Map<string, number>();
        related.forEach((item) =>
          item.changedFiles.forEach((file) =>
            counts.set(file, (counts.get(file) || 0) + 1),
          ),
        );
        competingGroups.push({
          branches: related.map((item) => item.branchName),
          taskIds: related.map((item) => item.taskId),
          sharedFiles: Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([file]) => file),
        });
      }
    }

    const pending = candidates.filter(
      (candidate) =>
        !candidate.ownerAuthoritative &&
        candidate.promotionState !== "approved-for-merge" &&
        candidate.promotionState !== "rejected",
    );
    const ownerAuthoritativeTesting = candidates.filter(
      (candidate) =>
        candidate.ownerAuthoritative &&
        candidate.promotionState !== "rejected",
    );

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        reviewCadenceDays: 7,
        mergePolicy: "owner-review-only",
        totalSandboxBranches: candidates.length,
        pendingReview: pending.length,
        ownerAuthoritativeTesting: ownerAuthoritativeTesting.length,
        successfulTested: pending.filter(
          (candidate) => candidate.checksPassed && candidate.pushed,
        ).length,
        approvedForMerge: candidates.filter(
          (candidate) => candidate.promotionState === "approved-for-merge",
        ).length,
        competingGroups,
        branches: candidates,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not build branch review report.";
    return NextResponse.json(
      { error: "Could not build branch review report.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const owner = await ownerContext();
    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const input = reviewSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const { data: task, error } = await admin
      .from("agent_tasks")
      .select(
        "id,owner_ref,repo_key,mode,status,branch_name,result,created_at,updated_at",
      )
      .eq("id", input.taskId)
      .eq("repo_key", "cooperative")
      .eq("mode", "prepare_change")
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      return NextResponse.json({ error: "Sandbox task not found." }, { status: 404 });
    }
    if (
      typeof task.branch_name !== "string" ||
      !task.branch_name.startsWith("sandbox/")
    ) {
      return NextResponse.json(
        { error: "That task is not an approved sandbox branch." },
        { status: 409 },
      );
    }

    const result = resultObject(task.result);
    const sandbox = sandboxObject(result);
    const checksPassed = result.checksPassed === true;
    const pushed = sandbox.pushed === true;

    if (
      input.decision === "approve-for-merge" &&
      (!checksPassed || !pushed)
    ) {
      return NextResponse.json(
        {
          error:
            "A branch must be pushed and pass its recorded checks before owner review can approve it for merge.",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const promotionState =
      input.decision === "approve-for-merge"
        ? "approved-for-merge"
        : input.decision === "reject"
          ? "rejected"
          : "testing";

    const nextResult = {
      ...result,
      sandbox: {
        ...sandbox,
        branchName: task.branch_name,
        promotionState,
        mergeAllowed: input.decision === "approve-for-merge",
        ownerReviewRequired: input.decision !== "approve-for-merge",
        reviewedAt: now,
        reviewDecision: input.decision,
        reviewNote: input.note?.trim() || null,
      },
    };

    const { error: updateError } = await admin
      .from("agent_tasks")
      .update({
        result: nextResult,
        status: input.decision === "reject" ? "cancelled" : task.status,
        updated_at: now,
      })
      .eq("id", task.id);
    if (updateError) throw updateError;

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "owner_branch_review",
      message:
        input.decision === "approve-for-merge"
          ? "Owner review approved the sandbox branch as eligible for a separate merge action."
          : input.decision === "reject"
            ? "Owner review rejected the sandbox branch."
            : "Owner review kept the sandbox branch in testing.",
      metadata: {
        branchName: task.branch_name,
        decision: input.decision,
        reviewedAt: now,
        mergeAllowed: input.decision === "approve-for-merge",
        reviewerRole: "platform-owner",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        taskId: task.id,
        branchName: task.branch_name,
        promotionState,
        mergeAllowed: input.decision === "approve-for-merge",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not review sandbox branch.";
    return NextResponse.json(
      { error: "Could not review sandbox branch.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
