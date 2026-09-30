import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { imageInferenceApiRequestSchema } from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 60;

const enqueueSchema = imageInferenceApiRequestSchema.extend({
  clientOwnerRef: z.string().min(1).max(160),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function extensionFor(contentType: string) {
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = enqueueSchema.parse(await request.json());
    const supabase = createAdminSupabaseClient();
    const jobId = crypto.randomUUID();
    const seed =
      input.seed ??
      (Number.parseInt(jobId.replaceAll("-", "").slice(0, 8), 16) % 2147483648);
    const referencePaths: Array<{ path: string; title?: string; contentType: string }> = [];

    for (let index = 0; index < input.referenceUrls.length; index += 1) {
      const reference = input.referenceUrls[index];
      const response = await fetch(reference.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Reference image fetch failed with ${response.status}.`);
      }

      const contentType = (response.headers.get("content-type") || "").split(";")[0];
      if (!contentType.startsWith("image/")) {
        throw new Error("Reference URL did not return an image.");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.byteLength > 12 * 1024 * 1024) {
        throw new Error("Reference image is empty or exceeds the 12 MB inference limit.");
      }

      const path = `jobs/${jobId}/references/${index}.${extensionFor(contentType)}`;
      const { error: uploadError } = await supabase.storage
        .from("inference-job-assets")
        .upload(path, bytes, {
          contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;
      referencePaths.push({ path, title: reference.title, contentType });
    }

    const { error } = await supabase.from("inference_jobs").insert({
      id: jobId,
      kind: "image",
      status: "queued",
      client_owner_ref: input.clientOwnerRef,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      profile: input.profile,
      negative_prompt: input.negativePrompt ?? null,
      steps: input.steps ?? null,
      guidance_scale: input.guidanceScale ?? null,
      strength: input.strength ?? null,
      variation_mode: input.variationMode,
      seed,
      reference_paths: referencePaths,
    });

    if (error) throw error;

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        profile: input.profile,
        variationMode: input.variationMode,
        seed,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not enqueue image generation.";
    console.error("CoOperative async image enqueue failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not enqueue image generation.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
