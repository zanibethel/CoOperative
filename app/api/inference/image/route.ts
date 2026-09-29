import { NextResponse } from "next/server";
import { generateImageLocalFirst } from "@/lib/inference/router";
import { imageInferenceRequestSchema } from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = imageInferenceRequestSchema.parse(await request.json());
    const result = await generateImageLocalFirst(body);

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
