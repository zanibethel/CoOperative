import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

type ClaimBody = {
  workerId?: unknown;
  interactiveOnly?: unknown;
};

function jobResponse(job: Record<string, unknown>) {
  return NextResponse.json(
    {
      jobId: job.id,
      messages: job.messages,
      profile: job.profile,
      capability: job.capability || "text",
      attachmentIds: Array.isArray(job.attachment_ids) ? job.attachment_ids : [],
      maxTokens: job.max_tokens,
      temperature: Number(job.temperature),
      routingPreference: job.routing_preference || "default",
      preferredNodeId: job.preferred_node_id || null,
      targetNodeId: job.target_node_id || null,
      interactiveLocal: Boolean(job.conversation_id && job.target_node_id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ClaimBody;
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-text-worker";
    const interactiveOnly = body.interactiveOnly === true;

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminSupabaseClient();

    if (interactiveOnly) {
      // While a PC is actively being used, it may only claim a chat that the
      // contributor explicitly pinned to this exact owned node. Community and
      // background work remain governed by the normal idle-only queue.
      const { data: node, error: nodeError } = await supabase
        .from("unison_nodes")
        .select("contributor_user_id")
        .eq("id", workerId)
        .maybeSingle();

      if (nodeError) throw nodeError;
      if (!node?.contributor_user_id) {
        return new Response(null, { status: 204 });
      }

      const ownerRef = `coop-user:${node.contributor_user_id}`;
      const { data: candidate, error: candidateError } = await supabase
        .from("text_inference_jobs")
        .select("id")
        .eq("status", "queued")
        .eq("target_node_id", workerId)
        .eq("client_owner_ref", ownerRef)
        .not("conversation_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (candidateError) throw candidateError;
      if (!candidate) {
        return new Response(null, { status: 204 });
      }

      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "running",
          worker_id: workerId,
          claimed_at: now,
          updated_at: now,
          error: null,
        })
        .eq("id", candidate.id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      if (claimError) throw claimError;
      if (!claimed) {
        return new Response(null, { status: 204 });
      }

      return jobResponse(claimed as Record<string, unknown>);
    }

    const { data, error } = await supabase.rpc("claim_next_text_inference_job", {
      p_worker_id: workerId,
      p_node_id: workerId,
    });
    if (error) throw error;

    const job = Array.isArray(data) ? data[0] : null;
    if (!job) {
      return new Response(null, { status: 204 });
    }

    return jobResponse(job as Record<string, unknown>);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim text inference job.";
    console.error("CoOperative text inference claim failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not claim text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
