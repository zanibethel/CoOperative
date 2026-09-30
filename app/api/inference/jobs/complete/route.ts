import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type CompletionBody = {
  jobId?: unknown;
  dataUrl?: unknown;
  model?: unknown;
  provider?: unknown;
  referencesUsed?: unknown;
  latencyMs?: unknown;
  error?: unknown;
};

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function parseDataUrl(value: string) {
  const prefixMatch = value.match(/^data:(image\/(?:png|jpeg|webp));base64,/);
  if (!prefixMatch) throw new Error("Unsupported generated image format.");

  const encoded = value.slice(prefixMatch[0].length);
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) {
    throw new Error("Generated image is empty or exceeds the 12 MB result limit.");
  }

  const contentType = prefixMatch[1];
  const extension =
    contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";

  return {
    bytes: new Uint8Array(buffer),
    contentType,
    extension,
  };
}

export async function POST(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CompletionBody;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error: jobError } = await supabase
      .from("inference_jobs")
      .select("id,status")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    if (typeof body.error === "string" && body.error.trim()) {
      const { error: updateError } = await supabase
        .from("inference_jobs")
        .update({
          status: "failed",
          error: body.error.slice(0, 1200),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      if (updateError) throw updateError;
      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.dataUrl !== "string" || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const image = parseDataUrl(body.dataUrl);
    const resultPath = `jobs/${jobId}/result.${image.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("inference-job-assets")
      .upload(resultPath, image.bytes, {
        contentType: image.contentType,
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const referencesUsed =
      typeof body.referencesUsed === "number" && Number.isInteger(body.referencesUsed)
        ? Math.max(0, Math.min(4, body.referencesUsed))
        : 0;
    const latencyMs =
      typeof body.latencyMs === "number" && Number.isFinite(body.latencyMs)
        ? Math.max(0, Math.round(body.latencyMs))
        : null;

    const { error: updateError } = await supabase
      .from("inference_jobs")
      .update({
        status: "completed",
        result_path: resultPath,
        result_model: body.model.slice(0, 300),
        result_provider:
          typeof body.provider === "string"
            ? body.provider.slice(0, 160)
            : "cooperative-worker",
        references_used: referencesUsed,
        latency_ms: latencyMs,
        error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete inference job.";
    console.error("CoOperative inference completion failed", { detail: detail.slice(0, 800) });

    return NextResponse.json(
      { error: "Could not complete inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
