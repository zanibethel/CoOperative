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

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "claimed",
      message: `Task claimed by ${workerId}.`,
      metadata: { workerId },
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim agent task.";
    return NextResponse.json(
      { error: "Could not claim agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
