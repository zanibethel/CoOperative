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
import { nousManagedMediaCatalog } from "@/lib/inference/nous-managed-media";
import {
  availableModelRegistryRoutes,
  registryRouteEligible,
} from "@/lib/inference/model-capability-registry";

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
    const [balance, openRouterService, nousPortalService] =
      await Promise.all([
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
    const [catalog, nousCatalog, registryAvailability] = await Promise.all([
      openRouterMediaCatalog(
        false,
        openRouterService?.credential || undefined,
      ),
      nousManagedMediaCatalog(),
      availableModelRegistryRoutes({
        providers: ["openrouter", "nous"],
        routeKinds: ["image", "video"],
        maxAgeHours: 36,
      }),
    ]);

    const openRouterImage = catalog.image.filter((model) =>
      registryRouteEligible(registryAvailability, {
        provider: "openrouter",
        model: model.id,
        routeKind: "image",
      }),
    );
    const openRouterVideo = catalog.video.filter((model) =>
      registryRouteEligible(registryAvailability, {
        provider: "openrouter",
        model: model.id,
        routeKind: "video",
      }),
    );
    const nousImage = nousCatalog.image.filter((model) =>
      registryRouteEligible(registryAvailability, {
        provider: "nous",
        model: model.model,
        routeKind: "image",
      }),
    );
    const nousVideo =
      nousCatalog.video &&
      registryRouteEligible(registryAvailability, {
        provider: "nous",
        model: nousCatalog.video.model,
        routeKind: "video",
      })
        ? nousCatalog.video
        : null;

    return NextResponse.json(
      {
        source: registryAvailability.authoritative
          ? "cooperative-model-registry+live-provider-catalog"
          : catalog.source,
        fetchedAt: catalog.fetchedAt,
        configured: {
          nous:
            Boolean(nousPortalService?.credential) ||
            Boolean(process.env.NOUS_API_KEY?.trim()),
          openRouter:
            Boolean(process.env.OPENROUTER_API_KEY?.trim()) ||
            Boolean(openRouterService?.credential),
        },
        routingPriority: ["nous", "local-or-free", "openrouter-paid"] as const,
        paidAiEligible: balance.funded,
        availableAiBalanceUsd: balance.availableUsd,
        registry: {
          authoritative: registryAvailability.authoritative,
          latestCompletedScanAt: registryAvailability.latestCompletedScanAt,
          availableRouteCount: registryAvailability.routes.length,
        },
        nous: {
          ...nousCatalog,
          image: nousImage,
          video: nousVideo,
        },
        image: {
          bands: mediaLevelBands(
            openRouterImage.some((model) => model.recommended)
              ? openRouterImage.filter((model) => model.recommended)
              : openRouterImage,
          ),
          recommended: tierRows(openRouterImage),
          models: openRouterImage,
        },
        video: {
          bands: mediaLevelBands(openRouterVideo),
          recommended: tierRows(openRouterVideo),
          models: openRouterVideo,
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
