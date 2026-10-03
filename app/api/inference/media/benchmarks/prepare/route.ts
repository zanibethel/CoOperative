import { NextResponse } from "next/server";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { prepareMediaQualityBenchmark } from "@/lib/inference/media-quality-benchmark";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const prepared = await prepareMediaQualityBenchmark();
    return NextResponse.json(prepared, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not prepare the media quality benchmark.",
        detail: error instanceof Error ? error.message : "Unknown benchmark preparation error.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
