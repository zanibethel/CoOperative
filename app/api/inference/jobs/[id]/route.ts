import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const ownerRef = new URL(request.url).searchParams.get("ownerRef") || "";
    if (!ownerRef) {
      return NextResponse.json({ error: "ownerRef is required." }, { status: 400 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error } = await supabase
      .from("inference_jobs")
      .select("*")
      .eq("id", id)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    let image: string | null = null;
    if (job.status === "completed" && job.result_path) {
      const { data: signed, error: signError } = await supabase.storage
        .from("inference-job-assets")
        .createSignedUrl(job.result_path, 15 * 60);
      if (signError) throw signError;
      image = signed?.signedUrl || null;
    }

    const referencePaths = Array.isArray(job.reference_paths) ? job.reference_paths : [];
    const referenceTitles = referencePaths
      .map((item) => (item && typeof item === "object" && typeof item.title === "string" ? item.title : null))
      .filter((value): value is string => Boolean(value));

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        profile: job.profile,
        image,
        model: job.result_model,
        provider: job.result_provider,
        referencesUsed: job.references_used,
        referenceTitles,
        latencyMs: job.latency_ms,
        error: job.error,
        aspectRatio: job.aspect_ratio,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read inference job.";
    return NextResponse.json(
      { error: "Could not read inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
