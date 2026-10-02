import { NextResponse } from "next/server";

import { aiProfileBalanceForUser } from "@/lib/billing/ai-profile-balance";
import {
  mediaLevelBands,
  openRouterMediaCatalog,
  recommendedForLevel,
  type MediaCatalogModel,
} from "@/lib/inference/openrouter-media-catalog";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";

export const runtime = "nodejs";
export const maxDuration = 30;

function tierRows(models: MediaCatalogModel[]) {
  return ([0, 1, 2, 3, 4] as const).map((level) => ({
    level,
    model: recommendedForLevel(models, level),
  }));
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ownerRef = `coop-user:${userId}`;
    const [catalog, balance, openRouterService, nousPortalService] =
      await Promise.all([
        openRouterMediaCatalog(),
        aiProfileBalanceForUser(userId),
        businessOwnedServiceCredentialForOwner(
          ownerRef,
          "openrouter-api",
        ),
        businessOwnedServiceCredentialForOwner(
          ownerRef,
          "nous-portal",
        ),
      ]);

    return NextResponse.json(
      {
        source: catalog.source,
        fetchedAt: catalog.fetchedAt,
        configured: {
          nous:
            Boolean(nousPortalService?.credential) ||
            Boolean(process.env.NOUS_API_KEY?.trim()),
          openRouter:
            Boolean(process.env.OPENROUTER_API_KEY?.trim()) ||
            Boolean(openRouterService?.credential),
        },
        routingPriority: ["nous", "openrouter", "local"] as const,
        paidAiEligible: balance.funded,
        availableAiBalanceUsd: balance.availableUsd,
        image: {
          bands: mediaLevelBands(catalog.image),
          recommended: tierRows(catalog.image),
          models: catalog.image,
        },
        video: {
          bands: mediaLevelBands(catalog.video),
          recommended: tierRows(catalog.video),
          models: catalog.video,
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not load live media catalog.";
    return NextResponse.json(
      { error: "Could not load live media catalog.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
