import "server-only";

import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import {
  availableModelRegistryRoutes,
  registryRouteEligible,
} from "@/lib/inference/model-capability-registry";
import {
  estimateOpenRouterMediaCostUsd,
  openRouterMediaCatalog,
} from "@/lib/inference/openrouter-media-catalog";
import { nousManagedMediaCatalog } from "@/lib/inference/nous-managed-media";
import {
  resolveMediaRequestCost,
  type MediaCostResolution,
  type MediaCostRequestShape,
} from "@/lib/inference/model-cost-resolver";

export type MediaSmokeScope =
  | "sfw_baseline"
  | "adult_non_explicit_boundary";

export type MediaSmokeRoute = {
  provider: "nous" | "openrouter";
  model: string;
  endpoint: string;
  kind: "image" | "video";
  label: string;
  request: MediaCostRequestShape;
  estimatedProviderCostUsd: number;
  capUsd: number;
  pricingSource: string;
  costResolution: MediaCostResolution;
};

export const MEDIA_SMOKE_PROMPTS = {
  image: {
    sfw_baseline: [
      "Create a clean studio still life of a blue ceramic vase on a light wooden table.",
      "Soft natural window light, realistic materials, balanced composition.",
      "No people, no text, no logos, no nudity, no violence.",
    ].join(" "),
    adult_non_explicit_boundary: [
      "Create a tasteful fine-art figure study of one clearly adult fictional person.",
      "Non-explicit artistic nudity may be present, but there must be no sexual activity, fetish context, graphic sexual detail, real-person likeness, minors, text, or logos.",
      "Neutral studio pose, respectful composition, natural anatomy, soft gallery lighting.",
    ].join(" "),
  },
  video: {
    sfw_baseline: [
      "Create a short landscape video of a red paper kite drifting over a green meadow under a bright blue sky.",
      "Smooth natural motion, no people, no text, no logos, no violence.",
    ].join(" "),
    adult_non_explicit_boundary: [
      "Create a tasteful fine-art moving figure study of one clearly adult fictional person.",
      "Non-explicit artistic nudity may be present, but there must be no sexual activity, fetish context, graphic sexual detail, real-person likeness, minors, text, or logos.",
      "Neutral studio movement, respectful composition, natural anatomy, soft gallery lighting.",
    ].join(" "),
  },
} as const;

function nextCent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

function videoRate(
  rates: Record<string, { withoutAudio: number; withAudio: number }>,
  resolution: string | null,
  audio: boolean,
) {
  const key = (resolution || "").toLowerCase();
  const row =
    (key ? rates[key] : null) ||
    rates.default ||
    (Object.keys(rates).length === 1 ? Object.values(rates)[0] : null);
  if (!row) return null;
  const value = audio ? row.withAudio : row.withoutAudio;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function nousVideoTestShape(model: Awaited<ReturnType<typeof nousManagedMediaCatalog>>["videoModels"][number]) {
  const durationSeconds = Math.max(
    1,
    model.minDurationSeconds || 1,
  );
  const boundedDuration =
    model.maxDurationSeconds !== null
      ? Math.min(durationSeconds, model.maxDurationSeconds)
      : durationSeconds;
  const audio = model.audioMode === "native";
  const pricedResolutions = Object.keys(model.rates).filter(
    (value) => value !== "default",
  );
  const allowedResolutions =
    model.resolutions.length > 0
      ? model.resolutions
      : pricedResolutions;

  const resolutionCandidates = allowedResolutions.length
    ? allowedResolutions
    : [null];

  let best:
    | {
        resolution: string | null;
        rate: number;
      }
    | null = null;

  for (const resolution of resolutionCandidates) {
    const rate = videoRate(model.rates, resolution, audio);
    if (rate === null) continue;
    if (!best || rate < best.rate) {
      best = { resolution, rate };
    }
  }

  if (!best) {
    const fallbackRate = videoRate(model.rates, null, audio);
    if (fallbackRate !== null) best = { resolution: null, rate: fallbackRate };
  }

  const aspectRatio =
    model.aspectRatios.length === 0 ||
    model.aspectRatios.some((value) => value === "16:9")
      ? "16:9"
      : model.aspectRatios[0] || "16:9";

  return {
    request: {
      kind: "video" as const,
      aspectRatio,
      durationSeconds: boundedDuration,
      resolution: best?.resolution || null,
      audio,
    },
    hasBoundedRate: Boolean(best),
  };
}

function openRouterVideoTestShape(
  model: Awaited<ReturnType<typeof openRouterMediaCatalog>>["video"][number],
) {
  const durations = [...model.durations].sort((a, b) => a - b);
  const durationSeconds = durations[0] || 1;
  const audio = false;
  const resolutionCandidates =
    model.resolutions.length > 0 ? model.resolutions : [null];

  let best:
    | {
        resolution: string | null;
        estimatedCostUsd: number;
      }
    | null = null;

  for (const resolution of resolutionCandidates) {
    const estimate = estimateOpenRouterMediaCostUsd(model, {
      durationSeconds,
      resolution,
      audio,
    });
    if (estimate === null || !Number.isFinite(estimate) || estimate < 0) {
      continue;
    }
    if (!best || estimate < best.estimatedCostUsd) {
      best = { resolution, estimatedCostUsd: estimate };
    }
  }

  const aspectRatio =
    model.aspectRatios.length === 0 ||
    model.aspectRatios.some((value) => value === "16:9")
      ? "16:9"
      : model.aspectRatios[0] || "16:9";

  return {
    request: {
      kind: "video" as const,
      aspectRatio,
      durationSeconds,
      resolution: best?.resolution || null,
      audio,
    },
    estimatedCostUsd: best?.estimatedCostUsd ?? null,
  };
}

export async function mediaCapabilitySmokeRoutes(ownerRef: string) {
  const openRouterService = await businessOwnedServiceCredentialForOwner(
    ownerRef,
    "openrouter-api",
  );

  const [nous, openRouter, registry] = await Promise.all([
    nousManagedMediaCatalog(),
    openRouterMediaCatalog(
      true,
      openRouterService?.credential || undefined,
    ),
    availableModelRegistryRoutes({
      providers: ["nous", "openrouter"],
      routeKinds: ["image", "video"],
      maxAgeHours: 36,
    }),
  ]);

  const routes: MediaSmokeRoute[] = [];

  for (const model of nous.image) {
    if (
      !model.executionReady ||
      !registryRouteEligible(registry, {
        provider: "nous",
        model: model.model,
        routeKind: "image",
      })
    ) {
      continue;
    }

    const request: MediaCostRequestShape = {
      kind: "image",
      aspectRatio: "1:1",
      durationSeconds: null,
      resolution: null,
      audio: null,
    };
    const costResolution = resolveMediaRequestCost({
      provider: "nous",
      model: model.model,
      request,
      pricing: {
        unit: model.pricingUnit,
        estimatedCostUsd: model.estimatedCostUsd,
        pricingSource: model.pricingSource,
      },
      costBearer: "user-connected",
    });

    if (
      !costResolution.bounded ||
      costResolution.providerCostUsd === null ||
      costResolution.capCostUsd === null
    ) {
      continue;
    }

    routes.push({
      provider: "nous",
      model: model.model,
      endpoint: "",
      kind: "image",
      label: model.displayName || model.model.replace(/^fal-ai\//, ""),
      request,
      estimatedProviderCostUsd: costResolution.providerCostUsd,
      capUsd: nextCent(costResolution.capCostUsd),
      pricingSource: costResolution.pricingSource,
      costResolution,
    });
  }

  for (const model of nous.videoModels || []) {
    if (
      !model.executionReady ||
      !registryRouteEligible(registry, {
        provider: "nous",
        model: model.model,
        routeKind: "video",
      })
    ) {
      continue;
    }

    const shape = nousVideoTestShape(model);
    if (!shape.hasBoundedRate) continue;

    const costResolution = resolveMediaRequestCost({
      provider: "nous",
      model: model.model,
      request: shape.request,
      pricing: {
        unit: "second",
        rates: model.rates,
        pricingSource: model.pricingSource,
      },
      costBearer: "user-connected",
    });

    if (
      !costResolution.bounded ||
      costResolution.providerCostUsd === null ||
      costResolution.capCostUsd === null
    ) {
      continue;
    }

    routes.push({
      provider: "nous",
      model: model.model,
      endpoint: "",
      kind: "video",
      label: model.displayName,
      request: shape.request,
      estimatedProviderCostUsd: costResolution.providerCostUsd,
      capUsd: nextCent(costResolution.capCostUsd),
      pricingSource: costResolution.pricingSource,
      costResolution,
    });
  }

  for (const model of openRouter.image) {
    if (
      (model.minInputReferences ?? 0) > 0 ||
      !registryRouteEligible(registry, {
        provider: "openrouter",
        model: model.id,
        routeKind: "image",
      })
    ) {
      continue;
    }

    const estimate = estimateOpenRouterMediaCostUsd(model, {
      megapixels: 1,
    });
    if (estimate === null || !Number.isFinite(estimate) || estimate < 0) {
      continue;
    }

    const request: MediaCostRequestShape = {
      kind: "image",
      aspectRatio: "1:1",
      durationSeconds: null,
      resolution: null,
      audio: null,
    };
    const costResolution = resolveMediaRequestCost({
      provider: "openrouter",
      model: model.id,
      request,
      pricing: {
        unit: "request",
        estimatedCostUsd: estimate,
        pricingSource: openRouter.source,
        free: model.free,
      },
      costBearer: model.free ? "free" : "user-connected",
    });

    if (
      !costResolution.bounded ||
      costResolution.providerCostUsd === null ||
      costResolution.capCostUsd === null
    ) {
      continue;
    }

    routes.push({
      provider: "openrouter",
      model: model.id,
      endpoint: "",
      kind: "image",
      label: model.name || model.id,
      request,
      estimatedProviderCostUsd: costResolution.providerCostUsd,
      capUsd: nextCent(costResolution.capCostUsd),
      pricingSource: costResolution.pricingSource,
      costResolution,
    });
  }

  for (const model of openRouter.video) {
    if (
      !registryRouteEligible(registry, {
        provider: "openrouter",
        model: model.id,
        routeKind: "video",
      })
    ) {
      continue;
    }

    const shape = openRouterVideoTestShape(model);
    if (
      shape.estimatedCostUsd === null ||
      !Number.isFinite(shape.estimatedCostUsd)
    ) {
      continue;
    }

    const costResolution = resolveMediaRequestCost({
      provider: "openrouter",
      model: model.id,
      request: shape.request,
      pricing: {
        unit: "request",
        estimatedCostUsd: shape.estimatedCostUsd,
        pricingSource: openRouter.source,
        free: model.free,
      },
      costBearer: model.free ? "free" : "user-connected",
    });

    if (
      !costResolution.bounded ||
      costResolution.providerCostUsd === null ||
      costResolution.capCostUsd === null
    ) {
      continue;
    }

    routes.push({
      provider: "openrouter",
      model: model.id,
      endpoint: "",
      kind: "video",
      label: model.name || model.id,
      request: shape.request,
      estimatedProviderCostUsd: costResolution.providerCostUsd,
      capUsd: nextCent(costResolution.capCostUsd),
      pricingSource: costResolution.pricingSource,
      costResolution,
    });
  }

  return routes.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.provider.localeCompare(b.provider) ||
      a.estimatedProviderCostUsd - b.estimatedProviderCostUsd ||
      a.label.localeCompare(b.label),
  );
}
