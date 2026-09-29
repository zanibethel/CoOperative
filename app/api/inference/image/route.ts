import { NextResponse } from "next/server";
import { generateImageLocalFirst } from "@/lib/inference/router";
import {
  imageInferenceApiRequestSchema,
  type ImageInferenceRequest,
} from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function materializeReferenceUrls(
  referenceUrls: Array<{ url: string; title?: string }>,
) {
  const references: Array<{ dataUrl: string; title?: string }> = [];

  for (const reference of referenceUrls) {
    const response = await fetch(reference.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Reference image fetch failed with ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error("Reference URL did not return an image.");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("Reference image is empty or exceeds the 12 MB inference limit.");
    }

    references.push({
      dataUrl: `data:${contentType.split(";")[0]};base64,${Buffer.from(bytes).toString("base64")}`,
      title: reference.title,
    });
  }

  return references;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = imageInferenceApiRequestSchema.parse(await request.json());
    const remoteReferences = await materializeReferenceUrls(body.referenceUrls);
    const inferenceRequest: ImageInferenceRequest = {
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      references: [...body.references, ...remoteReferences].slice(0, 4),
      negativePrompt: body.negativePrompt,
      steps: body.steps,
      guidanceScale: body.guidanceScale,
      strength: body.strength,
    };
    const result = await generateImageLocalFirst(inferenceRequest);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Image inference failed.";
    console.error("CoOperative image inference failed", { detail: detail.slice(0, 800) });

    return NextResponse.json(
      {
        error: "Image inference failed.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
