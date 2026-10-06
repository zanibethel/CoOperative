import { NextResponse } from "next/server";

import { aiProfileBalanceForUser } from "@/lib/billing/ai-profile-balance";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { latestModelRegistrySnapshot } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ownerRef = `coop-user:${userId}`;
    const [snapshot, balance, openRouterService, nousPortalService] =
      await Promise.all([
        latestModelRegistrySnapshot(),
        aiProfileBalanceForUser(userId),
        businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api"),
        businessOwnedServiceCredentialForOwner(ownerRef, "nous-portal"),
      ]);

    const userOpenRouterConnected = Boolean(openRouterService?.credential);
    const cooperativeOpenRouterConnected = Boolean(
      process.env.OPENROUTER_API_KEY?.trim(),
    );
    const nousConnected =
      Boolean(nousPortalService?.credential) ||
      Boolean(process.env.NOUS_API_KEY?.trim());

    const routes = snapshot.routes.map((route) => {
      const active = route.status === "active";
      const executionReady = route.execution_ready === true;
      let availableNow = false;
      let availabilityReason = "Registry route is not currently executable.";

      if (active && executionReady) {
        if (route.provider === "cooperative-local") {
          availableNow = true;
          availabilityReason =
            "Owned/local route is eligible; final execution still depends on an authorized compatible node being online.";
        } else if (route.provider === "nous") {
          availableNow = nousConnected;
          availabilityReason = nousConnected
            ? "Nous/Hermes is connected for this profile."
            : "Nous/Hermes is not currently connected for this profile.";
        } else if (route.provider === "openrouter") {
          if (route.free) {
            availableNow =
              userOpenRouterConnected || cooperativeOpenRouterConnected;
            availabilityReason = availableNow
              ? "A connected OpenRouter credential can execute this free route."
              : "OpenRouter is not currently connected.";
          } else if (userOpenRouterConnected) {
            availableNow = true;
            availabilityReason =
              "User-owned OpenRouter billing can execute this paid route subject to the request cap and provider balance.";
          } else {
            availableNow =
              cooperativeOpenRouterConnected && balance.funded;
            availabilityReason = availableNow
              ? "CoOperative-funded OpenRouter can execute this paid route subject to the request cap and available AI balance."
              : "This paid OpenRouter route needs either user-owned OpenRouter billing or funded CoOperative AI balance.";
          }
        } else {
          availabilityReason =
            "This provider is registered but does not yet have an enabled CoOperative executor.";
        }
      }

      return {
        id: route.id,
        provider: route.provider,
        model: route.model,
        endpoint: route.endpoint || "",
        routeKind: route.route_kind,
        displayName: route.display_name,
        status: route.status,
        free: route.free === true,
        recommended: route.recommended === true,
        executionReady,
        availableNow,
        availabilityReason,
        inputModalities: route.input_modalities || [],
        outputModalities: route.output_modalities || [],
        capabilitySummary: route.capability_summary || {},
        pricing: route.pricing || {},
        limits: route.limits || {},
        policySummary: route.policy_summary || {},
        runtimeSummary: route.runtime_summary || {},
        scoreSummary: route.score_summary || {},
        scoreVersion: route.score_version || null,
        scoreUpdatedAt: route.score_updated_at || null,
        firstSeenAt: route.first_seen_at,
        lastSeenAt: route.last_seen_at,
        lastChangedAt: route.last_changed_at,
      };
    });

    return NextResponse.json(
      {
        registry: {
          authoritative:
            snapshot.latestRun?.status === "completed" &&
            routes.some((route) => route.status === "active"),
          latestCompletedScanAt:
            snapshot.latestRun?.status === "completed"
              ? snapshot.latestRun.completed_at
              : null,
          totalRouteCount: routes.length,
          activeRouteCount: routes.filter((route) => route.status === "active")
            .length,
          executionReadyRouteCount: routes.filter(
            (route) => route.status === "active" && route.executionReady,
          ).length,
          availableNowRouteCount: routes.filter((route) => route.availableNow)
            .length,
          routes,
        },
        limits: {
          paidAiEligible: balance.funded,
          availableAiBalanceUsd: balance.availableUsd,
          openRouterConnected:
            userOpenRouterConnected || cooperativeOpenRouterConnected,
          openRouterByok: userOpenRouterConnected,
          nousConnected,
          policy:
            "Model Mixer may rank the full registry, but execution remains gated by provider connection, task capability, request spend ceiling, user balance/BYOK, content policy, route evidence, and live node availability.",
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not load the CoOperative model registry.";
    return NextResponse.json(
      {
        error: "Could not load the CoOperative model registry.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
