import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { AGENT_REGISTRY, AGENT_REPOSITORIES } from "@/lib/agents/registry";
import { localWorkerAuthorized } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { workerId?: unknown };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-repo-agent";

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("claim_next_agent_task", {
      p_worker_id: workerId,
    });
    if (error) throw error;

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

    const taskResult =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : {};
    const executorApproval =
      taskResult.executorApproval && typeof taskResult.executorApproval === "object"
        ? (taskResult.executorApproval as Record<string, unknown>)
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim agent task.";
    return NextResponse.json(
      { error: "Could not claim agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
