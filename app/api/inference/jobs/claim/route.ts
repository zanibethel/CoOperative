import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { workerId?: unknown };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-worker";

    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.rpc("claim_next_image_inference_job", {
      p_worker_id: workerId,
    });
    if (error) throw error;

    const job = Array.isArray(data) ? data[0] : null;
    if (!job) {
      return new Response(null, { status: 204 });
    }

    const storedReferences = Array.isArray(job.reference_paths) ? job.reference_paths : [];
    const references: Array<{ url: string; title?: string }> = [];

    for (const reference of storedReferences) {
      if (!reference || typeof reference !== "object" || typeof reference.path !== "string") continue;
      const { data: signed, error: signError } = await supabase.storage
        .from("inference-job-assets")
        .createSignedUrl(reference.path, 30 * 60);
      if (signError || !signed?.signedUrl) throw signError || new Error("Could not sign reference image.");
      references.push({
        url: signed.signedUrl,
        ...(typeof reference.title === "string" ? { title: reference.title } : {}),
      });
    }

    return NextResponse.json(
      {
        jobId: job.id,
        prompt: job.prompt,
        aspectRatio: job.aspect_ratio,
        profile: job.profile,
        references,
        negativePrompt: job.negative_prompt,
        steps: job.steps,
        guidanceScale: job.guidance_scale,
        strength: job.strength,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim inference job.";
    console.error("CoOperative inference claim failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not claim inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
