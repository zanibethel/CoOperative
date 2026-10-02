import { NextResponse } from "next/server";

import { aiProfileBalanceForUser } from "@/lib/billing/ai-profile-balance";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const balance = await aiProfileBalanceForUser(userId);
    return NextResponse.json(
      {
        balanceMicrousd: balance.balanceMicrousd,
        reservedMicrousd: balance.reservedMicrousd,
        availableMicrousd: balance.availableMicrousd,
        availableUsd: balance.availableUsd,
        lifetimeSpentMicrousd: balance.lifetimeSpentMicrousd,
        funded: balance.funded,
        paidAiEligible: balance.funded,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read AI balance.";
    return NextResponse.json(
      { error: "Could not read AI balance.", detail: detail.slice(0, 500) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
