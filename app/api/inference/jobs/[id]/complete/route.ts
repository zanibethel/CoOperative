import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const completionSchema = z.union([
  z.object({
    dataUrl: z.string().startsWith("data:image/"),
    model: z.string().min(1).max(300),
    provider: z.string().min(1).max(160).default("cooperative-worker"),
    referencesUsed: z.number().int().min(0).max(4).default(0),
    latencyMs: z.number().int().min(0).optional(),
  }),
  z.object({
    error: z.string().min(1).max(1200),
  }),
]);

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!match) throw new Error("Unsupported generated image format.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error("Generated image is empty or exceeds the 12 MB result limit.");
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1] === "image/webp" ? "webp" : "png";
  return { bytes, contentType: match[1], extension };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = completionSchema.parse(await request.json());
    const supabase = createAdminSupabaseClient();

    const { data: job, error: jobError } = await supabase
      .from("inference_jobs")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    if ("error" in body) {
      const { error } = await supabase
        .from("inference_jobs")
        .update({
          status: "failed",
          error: body.error,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true, status: "failed" });
    }

    const image = parseDataUrl(body.dataUrl);
    const resultPath = `jobs/${id}/result.${image.extension}`;
    const { error: uploadError } = await supabase.storage
      .from("inference-job-assets")
      .upload(resultPath, image.bytes, {
        contentType: image.contentType,
        cacheControl: "3600",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { error } = await supabase
      .from("inference_jobs")
      .update({
        status: "completed",
        result_path: resultPath,
        result_model: body.model,
        result_provider: body.provider,
        references_used: body.referencesUsed,
        latency_ms: body.latencyMs ?? null,
        error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

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
