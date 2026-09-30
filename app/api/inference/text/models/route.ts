import { NextResponse } from "next/server";
import { publicTextModelRegistry } from "@/lib/inference/text-model-registry";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(publicTextModelRegistry(), {
    headers: { "Cache-Control": "no-store" },
  });
}
