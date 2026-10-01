import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { workerId?: unknown };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-text-worker";

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.rpc("claim_next_text_inference_job", {
      p_worker_id: workerId,
      p_node_id: workerId,
    });
    if (error) throw error;

    const job = Array.isArray(data) ? data[0] : null;
    if (!job) {
      return new Response(null, { status: 204 });
    }

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
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim text inference job.";
    console.error("CoOperative text inference claim failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not claim text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
