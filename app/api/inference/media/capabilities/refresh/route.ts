import { NextResponse } from "next/server";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { refreshMediaPolicyEvidence } from "@/lib/inference/media-policy-evidence";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshMediaPolicyEvidence();
    return NextResponse.json(
      {
        refreshed: true,
        ...result,
        note:
          "Policy refresh records source-backed provider evidence without converting a general provider terms page into model capability. Exact-route capability still comes from model-specific evidence or controlled tests.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not refresh media policy evidence.";
    return NextResponse.json(
      {
        error: "Could not refresh media policy evidence.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
