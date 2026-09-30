import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId") || "";
    const ownerRef = url.searchParams.get("ownerRef") || "";

    if (!jobId || !ownerRef) {
      return NextResponse.json({ error: "jobId and ownerRef are required." }, { status: 400 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error } = await supabase
      .from("text_inference_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        profile: job.profile,
        text: job.result_text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        latencyMs: job.latency_ms,
        routingMode: job.routing_mode,
        taskClass: job.task_class,
        routeReason: job.route_reason,
        paidFallbackAllowed: job.allow_paid_fallback,
        humanApprovalRequired: job.human_approval_required,
        registryRevision: job.model_registry_revision,
        verificationStatus: job.verification_status,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read text inference job.";
    return NextResponse.json(
      { error: "Could not read text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
