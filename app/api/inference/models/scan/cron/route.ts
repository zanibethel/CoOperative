import { NextResponse } from "next/server";

import { scanModelCapabilities } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanModelCapabilities({
      triggerSource: "vercel-cron",
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Scheduled model capability scan failed.";

    return NextResponse.json(
      {
        error: "Scheduled model capability scan failed.",
        detail: detail.slice(0, 1600),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
