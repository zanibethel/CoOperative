import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workerId?: unknown;
      personalOnly?: unknown;
    };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-text-worker";

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const personalOnly = body.personalOnly === true;
    const supabase = createAdminSupabaseClient();
    const { data, error } = personalOnly
      ? await supabase.rpc("claim_next_personal_text_inference_job", {
          p_worker_id: workerId,
          p_node_id: workerId,
        })
      : await supabase.rpc("claim_next_text_inference_job", {
          p_worker_id: workerId,
          p_node_id: workerId,
        });
    if (error) throw error;

    const job = Array.isArray(data) ? data[0] : null;
    if (!job) {
      return new Response(null, { status: 204 });
    }

    const { data: ownership, error: ownershipError } = await supabase
      .from("text_inference_jobs")
      .select("client_owner_ref,personal_user_id")
      .eq("id", job.id)
      .maybeSingle();
    if (ownershipError) throw ownershipError;

    const ownerRef =
      typeof ownership?.client_owner_ref === "string"
        ? ownership.client_owner_ref
        : "";
    const ownerRefUserId =
      ownerRef.startsWith("coop-user:")
        ? ownerRef.slice("coop-user:".length)
        : ownerRef.startsWith("personal-user:")
          ? ownerRef.slice("personal-user:".length)
          : null;
    const profileUserId =
      typeof ownership?.personal_user_id === "string"
        ? ownership.personal_user_id
        : ownerRefUserId;

    let webAccessMode: "off" | "auto" | "always" = "off";
    if (profileUserId) {
      const { data: settings, error: settingsError } = await supabase
        .from("personal_ai_settings")
        .select("web_access_mode")
        .eq("user_id", profileUserId)
        .maybeSingle();
      if (settingsError) throw settingsError;
      if (
        settings?.web_access_mode === "auto" ||
        settings?.web_access_mode === "always"
      ) {
        webAccessMode = settings.web_access_mode;
      }
    }

    return NextResponse.json(
      {
        jobId: job.id,
        messages: job.messages,
        profile: job.profile,
        capability: job.capability || "text",
        attachmentIds: Array.isArray(job.attachment_ids) ? job.attachment_ids : [],
        sourceImageJobId:
          typeof job.source_image_job_id === "string"
            ? job.source_image_job_id
            : null,
        comparisonImageJobId:
          typeof job.comparison_image_job_id === "string"
            ? job.comparison_image_job_id
            : null,
        routingMode: job.routing_mode || "default",
        maxTokens: job.max_tokens,
        temperature: Number(job.temperature),
        routingPreference: job.routing_preference || "default",
        preferredNodeId: job.preferred_node_id || null,
        targetNodeId: job.target_node_id || null,
        personalUse: Boolean(job.personal_use),
        personalConversationId: job.personal_conversation_id || null,
        webAccessMode,
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
