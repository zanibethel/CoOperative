import "server-only";

import {
  estimateOpenRouterMediaCostUsd,
  recommendedForRequest,
  type MediaCatalog,
  type MediaCatalogModel,
} from "@/lib/inference/openrouter-media-catalog";
import {
  nousManagedMediaCatalog,
} from "@/lib/inference/nous-managed-media";
import {
  discoverNousReferenceImageModels,
  type NousReferenceImageModel,
} from "@/lib/inference/nous-reference-image-discovery";
import type { MediaRequestPlan } from "@/lib/inference/media-request";
import type { NousReferenceTransportVerification } from "@/lib/inference/nous-reference-transport-verification";

export const PREMIUM_REFERENCE_SMOKE_MODEL =
  "openai/gpt-image-2.5/sunburst/text-to-image";
export const PREMIUM_REFERENCE_SMOKE_EDIT_ENDPOINT =
  "openai/gpt-image-2.5/sunburst/edit";

export type MediaRecommendationTier = "high-end" | "balanced" | "lowest-cost";

export type MediaRecommendationOption = {
  tier: MediaRecommendationTier;
  label: string;
  provider: "nous" | "openrouter" | "cooperative-local";
  model: string;
  modelName: string;
  estimatedCostUsd: number;
  capUsd: number;
  increaseNeededUsd: number;
  summary: string;
  pricingSource: string;
  resolution: string | null;
  audio: boolean | null;
  executionReady: boolean;
  referenceBehavior: string | null;
  verificationNote: string | null;
  editEndpoint: string | null;
};

type Candidate = Omit<MediaRecommendationOption, "tier" | "label" | "increaseNeededUsd" | "summary"> & {
  qualityLevel: number;
};

function nextCent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

function supportsExactRequest(
  model: MediaCatalogModel,
  plan: MediaRequestPlan,
) {
  const durationOk =
    plan.kind !== "video" ||
    !plan.durationSeconds ||
    model.durations.length === 0 ||
    model.durations.includes(plan.durationSeconds);
  const aspectOk =
    !plan.aspectRatio ||
    model.aspectRatios.length === 0 ||
    model.aspectRatios.includes(plan.aspectRatio);
  const resolutionOk =
    plan.kind !== "video" ||
    !plan.resolution ||
    model.resolutions.length === 0 ||
    model.resolutions.some(
      (value) => value.toLowerCase() === plan.resolution?.toLowerCase(),
    );
  const audioOk =
    plan.kind !== "video" ||
    plan.audio !== true ||
    model.audioSupported;

  return durationOk && aspectOk && resolutionOk && audioOk;
}

function candidateKey(candidate: Candidate) {
  return [
    candidate.provider,
    candidate.model,
    candidate.resolution || "",
    candidate.audio === null ? "" : candidate.audio ? "audio" : "no-audio",
  ].join("|");
}

function summarize(
  candidate: Candidate,
  plan: MediaRequestPlan,
) {
  const details: string[] = [candidate.modelName];

  if (plan.kind === "video") {
    if (plan.durationSeconds) details.push(`${plan.durationSeconds}s`);
    if (candidate.resolution || plan.resolution) {
      details.push(candidate.resolution || plan.resolution || "");
    }
    if (plan.aspectRatio) details.push(plan.aspectRatio);
    if (candidate.audio === true || plan.audio === true) details.push("with audio");
    else if (candidate.audio === false || plan.audio === false) details.push("without audio");
  } else if (plan.aspectRatio) {
    details.push(plan.aspectRatio);
  }

  return details.filter(Boolean).join(" · ");
}

function asOption(
  tier: MediaRecommendationTier,
  label: string,
  candidate: Candidate,
  currentCapUsd: number,
  plan: MediaRequestPlan,
): MediaRecommendationOption {
  return {
    tier,
    label,
    provider: candidate.provider,
    model: candidate.model,
    modelName: candidate.modelName,
    estimatedCostUsd: candidate.estimatedCostUsd,
    capUsd: candidate.capUsd,
    increaseNeededUsd: Math.max(0, nextCent(candidate.capUsd - currentCapUsd)),
    summary: summarize(candidate, plan),
    pricingSource: candidate.pricingSource,
    resolution: candidate.resolution,
    audio: candidate.audio,
    executionReady: candidate.executionReady,
    referenceBehavior: candidate.referenceBehavior,
    verificationNote: candidate.verificationNote,
    editEndpoint: candidate.editEndpoint,
  };
}

function referenceQualityLevel(model: NousReferenceImageModel) {
  switch (model.capabilityClass) {
    case "precision-edit":
      return 5;
    case "identity-reference":
      return 4;
    case "semantic-multi-reference":
      return 3;
    case "multi-reference-edit":
      return 3;
    case "fast-reference-edit":
      return 1;
    default:
      return 2;
  }
}

function discoveredReferenceCandidate(
  model: NousReferenceImageModel,
  verification: NousReferenceTransportVerification | null | undefined,
): Candidate | null {
  if (
    model.pricing.status !== "verified-live" ||
    model.pricing.estimatedCostUsd === null ||
    !Number.isFinite(model.pricing.estimatedCostUsd)
  ) {
    return null;
  }

  return {
    provider: "nous",
    model: model.model,
    modelName: model.displayName,
    estimatedCostUsd: model.pricing.estimatedCostUsd,
    capUsd: nextCent(model.pricing.estimatedCostUsd),
    pricingSource: model.pricing.source,
    resolution: null,
    audio: null,
    executionReady:
      model.model === PREMIUM_REFERENCE_SMOKE_MODEL &&
      model.editEndpoint === PREMIUM_REFERENCE_SMOKE_EDIT_ENDPOINT &&
      verification?.readyForApprovedSmokeTest === true,
    referenceBehavior: model.capabilitySummary,
    verificationNote: verification
      ? verification.readyForApprovedSmokeTest
        ? model.model === PREMIUM_REFERENCE_SMOKE_MODEL &&
          model.editEndpoint === PREMIUM_REFERENCE_SMOKE_EDIT_ENDPOINT
          ? "Transport is verified. This is the single approved premium reference smoke-test route. Selecting it permits one capped generation attempt with no automatic retry or fallback; that first real gateway response will verify this exact edit endpoint."
          : "Hermes reference capability, live pricing, connected Nous managed-FAL entitlement, gateway reachability, and secure short-lived attachment handoff are verified. This model remains display-only until it is separately approved for a one-model smoke test."
        : [
            "Hermes reference capability and live pricing are verified.",
            verification.account.detail,
            verification.attachment.detail,
            verification.gateway.reachable
              ? null
              : "The managed FAL gateway host was not reachable during verification.",
          ]
            .filter(Boolean)
            .join(" ")
      : "Hermes reference capability and live pricing are verified. Connected Nous transport verification has not run for this request.",
    editEndpoint: model.editEndpoint,
    qualityLevel: referenceQualityLevel(model),
  };
}

function distinctCandidate(
  candidates: Candidate[],
  excluded: Set<string>,
  targetCostUsd: number | null = null,
) {
  const available = candidates.filter((candidate) => !excluded.has(candidateKey(candidate)));
  if (!available.length) return null;

  if (targetCostUsd === null) {
    return available[0];
  }

  return [...available].sort(
    (a, b) =>
      Math.abs(a.estimatedCostUsd - targetCostUsd) -
        Math.abs(b.estimatedCostUsd - targetCostUsd) ||
      b.qualityLevel - a.qualityLevel,
  )[0];
}

export async function buildMediaRecommendationOptions(input: {
  plan: MediaRequestPlan;
  openRouterCatalog: MediaCatalog | null;
  currentCapUsd: number;
  localImageAvailable?: boolean;
  requiresReferenceImage?: boolean;
  referenceVerification?: NousReferenceTransportVerification | null;
}) {
  const { plan, openRouterCatalog, currentCapUsd } = input;
  const candidates: Candidate[] = [];
  const requestShape = {
    durationSeconds: plan.durationSeconds,
    aspectRatio: plan.aspectRatio,
    resolution: plan.resolution,
    audio: plan.audio,
  };

  const openRouterPool =
    plan.kind === "video"
      ? openRouterCatalog?.video || []
      : input.requiresReferenceImage
        ? []
        : openRouterCatalog?.image || [];
  const exactOpenRouter = openRouterPool.filter((model) =>
    supportsExactRequest(model, plan),
  );

  for (const model of exactOpenRouter) {
    const estimatedCostUsd = estimateOpenRouterMediaCostUsd(model, {
      durationSeconds: plan.durationSeconds,
      resolution: plan.resolution,
      audio: plan.audio,
    });
    if (estimatedCostUsd === null || !Number.isFinite(estimatedCostUsd)) continue;

    candidates.push({
      provider: "openrouter",
      model: model.id,
      modelName: model.name || model.id,
      estimatedCostUsd,
      capUsd: nextCent(estimatedCostUsd),
      pricingSource: openRouterCatalog?.source || "openrouter-live",
      resolution: plan.resolution,
      audio: plan.kind === "video" ? plan.audio : null,
      qualityLevel: model.free ? 0 : 2,
      executionReady: true,
      referenceBehavior: null,
      verificationNote: null,
      editEndpoint: null,
    });
  }

  const nousCatalog = await nousManagedMediaCatalog();

  if (plan.kind === "video" && plan.durationSeconds && nousCatalog.video) {
    const requestedAudio = plan.audio ?? false;
    const resolutionEntries = plan.resolution
      ? [[plan.resolution.toLowerCase(), nousCatalog.video.rates[plan.resolution.toLowerCase()]] as const]
      : Object.entries(nousCatalog.video.rates);

    for (const [resolution, rates] of resolutionEntries) {
      if (!rates) continue;
      const rate = requestedAudio ? rates.withAudio : rates.withoutAudio;
      const estimatedCostUsd = plan.durationSeconds * rate;
      if (!Number.isFinite(estimatedCostUsd)) continue;

      candidates.push({
        provider: "nous",
        model: nousCatalog.video.model,
        modelName: "PixVerse V6",
        estimatedCostUsd,
        capUsd: nextCent(estimatedCostUsd),
        pricingSource: nousCatalog.video.pricingSource,
        resolution,
        audio: requestedAudio,
        qualityLevel:
          resolution === "1080p" ? 4 :
          resolution === "720p" ? 3 :
          resolution === "540p" ? 2 : 1,
        executionReady: true,
        referenceBehavior: null,
        verificationNote: null,
        editEndpoint: null,
      });
    }
  }

  if (plan.kind === "image") {
    if (input.requiresReferenceImage) {
      const referenceCatalog = await discoverNousReferenceImageModels();
      for (const model of referenceCatalog.models) {
        const candidate = discoveredReferenceCandidate(
          model,
          input.referenceVerification,
        );
        if (candidate) candidates.push(candidate);
      }
    }

    if (!input.requiresReferenceImage) {
      for (const model of nousCatalog.image) {
        candidates.push({
          provider: "nous",
          model: model.model,
          modelName: model.model.replace(/^fal-ai\//, ""),
          estimatedCostUsd: model.estimatedCostUsd,
          capUsd: nextCent(model.estimatedCostUsd),
          pricingSource: model.pricingSource,
          resolution: null,
          audio: null,
          qualityLevel: model.minLevel,
          executionReady: true,
          referenceBehavior: null,
          verificationNote: null,
          editEndpoint: null,
        });
      }
    }

    if (input.localImageAvailable) {
      if (input.requiresReferenceImage) {
        candidates.push(
          {
            provider: "cooperative-local",
            model: "local-image-quality-identity",
            modelName: "Owned Local Quality · Identity",
            estimatedCostUsd: 0,
            capUsd: 0,
            pricingSource: "owned-local",
            resolution: null,
            audio: null,
            qualityLevel: 4,
            executionReady: true,
            referenceBehavior:
              "Uses the attached reference image through the owned local identity/reference pipeline.",
            verificationNote:
              "Owned local reference-image execution is already wired.",
            editEndpoint: null,
          },
          {
            provider: "cooperative-local",
            model: "local-image-quality-reference",
            modelName: "Owned Local Quality · Reference",
            estimatedCostUsd: 0,
            capUsd: 0,
            pricingSource: "owned-local",
            resolution: null,
            audio: null,
            qualityLevel: 2,
            executionReady: true,
            referenceBehavior:
              "Uses the attached reference image through the owned local quality/reference pipeline.",
            verificationNote:
              "Owned local reference-image execution is already wired.",
            editEndpoint: null,
          },
          {
            provider: "cooperative-local",
            model: "local-image-fast-reference",
            modelName: "Owned Local Fast · Reference",
            estimatedCostUsd: 0,
            capUsd: 0,
            pricingSource: "owned-local",
            resolution: null,
            audio: null,
            qualityLevel: 1,
            executionReady: true,
            referenceBehavior:
              "Uses the attached reference image through the owned local fast/reference pipeline.",
            verificationNote:
              "Owned local reference-image execution is already wired.",
            editEndpoint: null,
          },
        );
      } else {
        candidates.push({
          provider: "cooperative-local",
          model: "local-image-quality",
          modelName: "Owned local image generator",
          estimatedCostUsd: 0,
          capUsd: 0,
          pricingSource: "owned-local",
          resolution: null,
          audio: null,
          qualityLevel: 1,
          executionReady: true,
          referenceBehavior: null,
          verificationNote: null,
          editEndpoint: null,
        });
      }
    }
  }

  const deduped = [...new Map(candidates.map((candidate) => [candidateKey(candidate), candidate])).values()]
    .sort(
      (a, b) =>
        a.estimatedCostUsd - b.estimatedCostUsd ||
        a.qualityLevel - b.qualityLevel ||
        a.modelName.localeCompare(b.modelName),
    );

  if (!deduped.length) {
    return {
      options: [] as MediaRecommendationOption[],
      fetchedAt: new Date().toISOString(),
    };
  }

  const low = deduped[0];

  const premiumModel = exactOpenRouter.length
    ? recommendedForRequest(exactOpenRouter, 4, requestShape)
    : null;
  let high =
    (premiumModel &&
      deduped.find(
        (candidate) =>
          candidate.provider === "openrouter" &&
          candidate.model === premiumModel.id,
      )) ||
    [...deduped].sort(
      (a, b) =>
        b.qualityLevel - a.qualityLevel ||
        b.estimatedCostUsd - a.estimatedCostUsd,
    )[0];

  if (candidateKey(high) === candidateKey(low) && deduped.length > 1) {
    high = deduped[deduped.length - 1];
  }

  const excluded = new Set([candidateKey(low), candidateKey(high)]);
  const midpoint = (low.estimatedCostUsd + high.estimatedCostUsd) / 2;

  const balancedModel = exactOpenRouter.length
    ? recommendedForRequest(exactOpenRouter, 2, requestShape)
    : null;
  let balanced =
    (balancedModel &&
      deduped.find(
        (candidate) =>
          !excluded.has(candidateKey(candidate)) &&
          candidate.provider === "openrouter" &&
          candidate.model === balancedModel.id,
      )) ||
    distinctCandidate(deduped, excluded, midpoint);

  if (!balanced) {
    balanced = distinctCandidate(deduped, new Set([candidateKey(low)]), midpoint) || high;
  }

  const options = [
    asOption("high-end", "High-end", high, currentCapUsd, plan),
    asOption("lowest-cost", "Lowest cost", low, currentCapUsd, plan),
    asOption("balanced", "Balanced", balanced, currentCapUsd, plan),
  ];

  return {
    options,
    fetchedAt: new Date().toISOString(),
  };
}

export function requestedMediaRecommendationTier(
  message: string,
): MediaRecommendationTier | null {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(high[- ]?end|premium)\b.*\b(?:media )?(?:option|recommendation)\b/.test(value)) {
    return "high-end";
  }
  if (/\b(balanced|middle|medium)\b.*\b(?:media )?(?:option|recommendation)\b/.test(value)) {
    return "balanced";
  }
  if (/\b(lowest[- ]?cost|cheapest|low[- ]?cost)\b.*\b(?:media )?(?:option|recommendation)\b/.test(value)) {
    return "lowest-cost";
  }
  return null;
}
