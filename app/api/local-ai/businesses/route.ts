import { NextResponse } from "next/server";

import { businessSummariesForUser } from "@/lib/ai/business-context";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const businesses = await businessSummariesForUser(userId);
    return NextResponse.json(
      { businesses },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not load businesses.";
    return NextResponse.json(
      { error: "Could not load businesses.", detail: detail.slice(0, 500) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
