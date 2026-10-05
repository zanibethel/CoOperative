import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { AGENT_REGISTRY, AGENT_REPOSITORIES } from "@/lib/agents/registry";
import { authorizeAgentWorker } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { workerId?: unknown };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-repo-agent";

    const admin = createAdminSupabaseClient();
    const claimResult =
      authorization.mode === "node"
        ? await admin.rpc("claim_next_agent_task_for_owner", {
            p_worker_id: workerId,
            p_owner_ref: authorization.ownerRef,
          })
        : await admin.rpc("claim_next_agent_task", {
            p_worker_id: workerId,
          });
    if (claimResult.error) throw claimResult.error;
    const data = claimResult.data;

    const task = Array.isArray(data) ? data[0] : null;
    if (!task) return new Response(null, { status: 204 });

    const agent = AGENT_REGISTRY[task.agent_key as keyof typeof AGENT_REGISTRY];
    const repository = AGENT_REPOSITORIES[task.repo_key as keyof typeof AGENT_REPOSITORIES];
    if (!agent || !repository) {
      throw new Error("Claimed task references an unknown agent or repository.");
    }

    const { data: recentCancelled } = await admin
      .from("agent_tasks")
      .select("id,objective,result,updated_at")
      .eq("owner_ref", task.owner_ref)
      .eq("repo_key", task.repo_key)
      .eq("status", "cancelled")
      .neq("id", task.id)
      .order("updated_at", { ascending: false })
      .limit(8);

    const learningContext = (recentCancelled || [])
      .filter((row) => {
        const result =
          row.result && typeof row.result === "object"
            ? (row.result as Record<string, unknown>)
            : {};
        return result.reviewDecision === "denied";
      })
      .slice(0, 3)
      .map((row) => {
        const result =
          row.result && typeof row.result === "object"
            ? (row.result as Record<string, unknown>)
            : {};
        const feedback =
          result.reviewFeedback && typeof result.reviewFeedback === "object"
            ? (result.reviewFeedback as Record<string, unknown>)
            : {};
        return {
          taskId: row.id,
          objective:
            typeof row.objective === "string" ? row.objective.slice(0, 1800) : "",
          summary:
            typeof result.summary === "string" ? result.summary.slice(0, 1200) : "",
          signals: Array.isArray(feedback.signals)
            ? feedback.signals
                .filter((value): value is string => typeof value === "string")
                .slice(0, 8)
            : [],
          diffStat:
            typeof result.diffStat === "string"
              ? result.diffStat.slice(0, 1200)
              : "",
          changedFiles: Array.isArray(result.changedFiles)
            ? result.changedFiles
                .filter((value): value is string => typeof value === "string")
                .slice(0, 10)
            : [],
        };
      });

    const { data: recentSandboxRows, error: sandboxRowsError } = await admin
      .from("agent_tasks")
      .select("id,branch_name,result,updated_at")
      .eq("repo_key", task.repo_key)
      .eq("mode", "prepare_change")
      .neq("id", task.id)
      .not("branch_name", "is", null)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (sandboxRowsError) throw sandboxRowsError;

    const sandboxCandidates = (recentSandboxRows || [])
      .map((row) => {
        const result =
          row.result && typeof row.result === "object"
            ? (row.result as Record<string, unknown>)
            : {};
        const sandbox =
          result.sandbox && typeof result.sandbox === "object"
            ? (result.sandbox as Record<string, unknown>)
            : {};
        return {
          taskId: row.id,
          branchName:
            typeof row.branch_name === "string" ? row.branch_name : "",
          summary:
            typeof result.summary === "string"
              ? result.summary.slice(0, 800)
              : "",
          changedFiles: Array.isArray(result.changedFiles)
            ? result.changedFiles
                .filter((value): value is string => typeof value === "string")
                .slice(0, 16)
            : [],
          diffStat:
            typeof result.diffStat === "string"
              ? result.diffStat.slice(0, 1000)
              : "",
          checksPassed: result.checksPassed === true,
          pushed: sandbox.pushed === true,
          commitSha:
            typeof sandbox.commitSha === "string" ? sandbox.commitSha : null,
          promotionState:
            typeof sandbox.promotionState === "string"
              ? sandbox.promotionState
              : "testing",
        };
      })
      .filter(
        (candidate) =>
          candidate.branchName.startsWith("sandbox/") &&
          candidate.checksPassed &&
          candidate.pushed &&
          candidate.promotionState !== "rejected",
      )
      .slice(0, 8);

    const taskResult =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : {};
    const executorApproval =
      taskResult.executorApproval && typeof taskResult.executorApproval === "object"
        ? (taskResult.executorApproval as Record<string, unknown>)
        : null;
    const governance =
      taskResult.governance && typeof taskResult.governance === "object"
        ? (taskResult.governance as Record<string, unknown>)
        : null;
    const sandbox =
      taskResult.sandbox && typeof taskResult.sandbox === "object"
        ? (taskResult.sandbox as Record<string, unknown>)
        : null;
    const sandboxBaseBranch =
      sandbox && typeof sandbox.baseBranch === "string"
        ? sandbox.baseBranch
        : null;

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "claimed",
      message: `Task claimed by ${workerId}.`,
      metadata: {
        workerId,
        deniedExamplesLoaded: learningContext.length,
        paidExecutorApproved: Boolean(executorApproval),
        governanceAuthority:
          governance && typeof governance.authority === "string"
            ? governance.authority
            : "standard-user",
        sandboxBaseBranch,
        reusableSandboxCandidates: sandboxCandidates.length,
        workerAuthMode: authorization.mode,
        nodeId: authorization.mode === "node" ? authorization.nodeId : null,
      },
    });

    return NextResponse.json({
      taskId: task.id,
      ownerRef: task.owner_ref,
      agentKey: task.agent_key,
      repoKey: task.repo_key,
      mode: task.mode,
      objective: task.objective,
      requestedProfile: task.requested_profile,
      agent,
      repository,
      learningContext,
      executorApproval,
      governance,
      sandbox,
      sandboxBaseBranch,
      sandboxCandidates,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim agent task.";
    return NextResponse.json(
      { error: "Could not claim agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
