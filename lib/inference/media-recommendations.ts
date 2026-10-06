import "server-only";

import { resolveMediaRequestCost, type MediaCostResolution } from "@/lib/inference/model-cost-resolver";
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
import type {
  MediaAdultContentClass,
  MediaRequestPlan,
} from "@/lib/inference/media-request";
import type { NousReferenceTransportVerification } from "@/lib/inference/nous-reference-transport-verification";
import type { MediaReferenceModelVerification } from "@/lib/inference/media-reference-model-verification";
import {
  availableModelRegistryRoutes,
  registryRouteEligible,
  registryTaskScore,
} from "@/lib/inference/model-capability-registry";
import {
  mediaBenchmarkQualityComposite,
  mediaBenchmarkSummaryForRoute,
  type MediaBenchmarkDimensionScores,
  type MediaBenchmarkEvidence,
} from "@/lib/inference/media-model-benchmarks";

export const PREMIUM_REFERENCE_SMOKE_MODEL =
  "openai/gpt-image-2.5/sunburst/text-to-image";
export const PREMIUM_REFERENCE_SMOKE_EDIT_ENDPOINT =
  "openai/gpt-image-2.5/sunburst/edit";
export const FLUX2_PRO_REFERENCE_SMOKE_MODEL = "fal-ai/flux-2-pro";
export const FLUX2_PRO_REFERENCE_SMOKE_EDIT_ENDPOINT =
  "fal-ai/flux-2-pro/edit";

export function isApprovedPremiumReferenceSmokeRoute(
  model: string,
  editEndpoint: string | null,
) {
  return (
    (model === PREMIUM_REFERENCE_SMOKE_MODEL &&
      editEndpoint === PREMIUM_REFERENCE_SMOKE_EDIT_ENDPOINT) ||
    (model === FLUX2_PRO_REFERENCE_SMOKE_MODEL &&
      editEndpoint === FLUX2_PRO_REFERENCE_SMOKE_EDIT_ENDPOINT)
  );
}

export type MediaRecommendationTier = "high-end" | "balanced" | "lowest-cost";
export type MediaContentPreference =
  | "sfw_only"
  | "adult_allowed"
  | "prefer_adult_capable"
  | "require_adult_capable";
export type AdultCapabilityState = "verified" | "blocked" | "unknown";

export type MediaAdultCapabilityEvidence = {
  provider: string;
  model: string;
  endpoint: string | null;
  policy: "unknown" | "disallowed" | "allowed";
  policySource: string | null;
  nonExplicitPolicy: "unknown" | "disallowed" | "allowed";
  nonExplicitPolicySource: string | null;
  explicitPolicy: "unknown" | "disallowed" | "allowed";
  explicitPolicySource: string | null;
  latestTestOutcome: "supported" | "blocked" | "partial" | "inconclusive" | null;
  latestPromptClassification: string | null;
  latestTestedAt: string | null;
};

export type MediaExecutionRecipe = {
  workflow: "text-to-image" | "reference-image-edit" | "text-to-video";
  qualityIntent: "maximum-quality" | "balanced-quality-value" | "cost-efficient";
  aspectRatio: string | null;
  resolution: string | null;
  durationSeconds: number | null;
  audio: boolean | null;
  contentConstraint: "sfw-output" | "request-controlled-adult-output";
};

export type MediaRouteScorecard = {
  qualityScore: number;
  qualitySource: "benchmark" | "mixed" | "heuristic";
  benchmarkCoverage: number;
  measuredDimensions: number;
  latestMeasuredAt: string | null;
  dimensions: MediaBenchmarkDimensionScores;
  selectionBasis: string;
  registryPerformanceScore?: number | null;
  registryCostEfficiencyScore?: number | null;
  registryOverallValueScore?: number | null;
  registryConfidence?: number | null;
};

export type MediaRecommendationOption = {
  tier: MediaRecommendationTier;
  label: string;
  provider: "nous" | "openrouter" | "cooperative-local";
  model: string;
  modelName: string;
  estimatedCostUsd: number;
  providerCostEstimateUsd: number;
  markupPercent: number;
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
  recipe: MediaExecutionRecipe;
  adultCapability: AdultCapabilityState;
  adultCapabilityNote: string | null;
  scorecard: MediaRouteScorecard;
  costResolution?: MediaCostResolution;
};

type Candidate = Omit<
  MediaRecommendationOption,
  | "tier"
  | "label"
  | "increaseNeededUsd"
  | "summary"
  | "recipe"
  | "adultCapability"
  | "adultCapabilityNote"
  | "scorecard"
> & {
  qualityLevel: number;
  adultCapability?: AdultCapabilityState;
  adultCapabilityNote?: string | null;
  scorecard?: MediaRouteScorecard;
};

function adultCapabilityFor(
  candidate: Pick<Candidate, "provider" | "model" | "editEndpoint">,
  evidence: MediaAdultCapabilityEvidence[] | undefined,
  requestedClass: MediaAdultContentClass,
): { state: AdultCapabilityState; note: string | null } {
  const match = evidence?.find(
    (item) =>
      item.provider === candidate.provider &&
      item.model === candidate.model &&
      (item.endpoint || "") === (candidate.editEndpoint || ""),
  );

  if (!match) {
    return {
      state: "unknown",
      note: "Adult capability has not been verified for this exact route.",
    };
  }

  const scopedPolicy =
    requestedClass === "adult_explicit"
      ? match.explicitPolicy
      : match.nonExplicitPolicy;
  const effectivePolicy =
    scopedPolicy === "allowed" || scopedPolicy === "disallowed"
      ? scopedPolicy
      : match.policy;
  const effectivePolicySource =
    requestedClass === "adult_explicit"
      ? match.explicitPolicySource || match.policySource
      : match.nonExplicitPolicySource || match.policySource;

  if (effectivePolicy === "disallowed") {
    return {
      state: "blocked",
      note: effectivePolicySource
        ? `Current provider/model policy marks this adult-output scope as disallowed (${effectivePolicySource}).`
        : "Current provider/model policy marks this adult-output scope as disallowed.",
    };
  }

  const classification = match.latestPromptClassification;
  const testApplies =
    classification === "adult_explicit_boundary" ||
    (classification === "adult_non_explicit_boundary" &&
      requestedClass === "adult_non_explicit");

  if (match.latestTestOutcome === "blocked" && testApplies) {
    return {
      state: "blocked",
      note: `The latest controlled adult-capability test that covers this scope was blocked${match.latestTestedAt ? ` on ${new Date(match.latestTestedAt).toLocaleDateString("en-US")}` : ""}.`,
    };
  }

  if (match.latestTestOutcome === "supported" && testApplies) {
    return {
      state: "verified",
      note: `A controlled test verified this exact route for ${classification === "adult_explicit_boundary" ? "explicit adult" : "non-explicit adult/nudity"} output${match.latestTestedAt ? ` on ${new Date(match.latestTestedAt).toLocaleDateString("en-US")}` : ""}.`,
    };
  }

  if (effectivePolicy === "allowed") {
    return {
      state: "verified",
      note: effectivePolicySource
        ? `Current exact-route provider/model policy permits this adult-output scope (${effectivePolicySource}).`
        : "Current exact-route provider/model policy permits this adult-output scope.",
    };
  }

  if (
    requestedClass === "adult_explicit" &&
    classification === "adult_non_explicit_boundary" &&
    match.latestTestOutcome === "supported"
  ) {
    return {
      state: "unknown",
      note:
        "This route passed a non-explicit adult/nudity test, but that evidence does not verify sexually explicit output.",
    };
  }

  return {
    state: "unknown",
    note:
      match.latestTestOutcome === "partial"
        ? "The latest controlled adult-capability test was only partially successful, so this route is not treated as verified."
        : "Adult capability remains unverified for this exact route and requested scope.",
  };
}

function contentConstraintFor(
  preference: MediaContentPreference,
  adultOutputRequested: boolean,
): MediaExecutionRecipe["contentConstraint"] {
  return adultOutputRequested && preference !== "sfw_only"
    ? "request-controlled-adult-output"
    : "sfw-output";
}

function workflowFor(
  plan: MediaRequestPlan,
  requiresReferenceImage: boolean,
): MediaExecutionRecipe["workflow"] {
  if (plan.kind === "video") return "text-to-video";
  return requiresReferenceImage ? "reference-image-edit" : "text-to-image";
}

function equivalentVideoResolution(a: string | null, b: string | null) {
  const normalize = (value: string | null) => {
    const normalized = (value || "").toLowerCase();
    if (normalized === "4k") return "2160p";
    if (normalized === "2k") return "1440p";
    return normalized;
  };
  return normalize(a) === normalize(b);
}

function resolutionQuality(value: string | null) {
  switch ((value || "").toLowerCase()) {
    case "4k":
      return 5;
    case "1080p":
      return 4;
    case "720p":
      return 3;
    case "540p":
      return 2;
    case "480p":
      return 1.5;
    case "360p":
      return 1;
    default:
      return 0;
  }
}

function routeScorecardFor(
  candidate: Candidate,
  evidence: MediaBenchmarkEvidence[] | undefined,
  requiresReferenceImage: boolean,
): MediaRouteScorecard {
  const summary = mediaBenchmarkSummaryForRoute(evidence, {
    provider: candidate.provider,
    model: candidate.model,
    endpoint: candidate.editEndpoint || "",
  });
  const heuristicScore = Math.max(
    0,
    Math.min(100, candidate.qualityLevel * 20),
  );
  const composite = mediaBenchmarkQualityComposite({
    summary,
    heuristicScore,
    referenceWorkflow: requiresReferenceImage,
  });
  const selectionBasis =
    composite.qualitySource === "benchmark"
      ? "Quality ranking is based on measured benchmark evidence for the weighted request dimensions."
      : composite.qualitySource === "mixed"
        ? `${Math.round(composite.benchmarkCoverage * 100)}% of the weighted quality signal is measured; the remainder uses current catalog/model-tier evidence.`
        : "This exact route has not been quality-benchmarked yet, so ranking currently uses catalog/model-tier evidence.";

  return {
    qualityScore: composite.qualityScore,
    qualitySource: composite.qualitySource,
    benchmarkCoverage: composite.benchmarkCoverage,
    measuredDimensions: summary.measuredDimensions,
    latestMeasuredAt: summary.latestMeasuredAt,
    dimensions: summary.dimensions,
    selectionBasis,
  };
}

function configurationQualityScore(
  candidate: Candidate,
  preference: MediaContentPreference,
  adultOutputRequested: boolean,
) {
  const adultPreferenceBonus =
    adultOutputRequested &&
    preference === "prefer_adult_capable" &&
    candidate.adultCapability === "verified"
      ? 4
      : 0;
  const baseQuality = candidate.scorecard?.qualityScore ?? candidate.qualityLevel * 20;
  return baseQuality + resolutionQuality(candidate.resolution) * 2 + adultPreferenceBonus;
}

function withAdultCapability(
  candidate: Candidate,
  evidence: MediaAdultCapabilityEvidence[] | undefined,
  requestedClass: MediaAdultContentClass,
): Candidate {
  const capability = adultCapabilityFor(candidate, evidence, requestedClass);
  return {
    ...candidate,
    adultCapability: capability.state,
    adultCapabilityNote: capability.note,
  };
}

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
  contentPreference: MediaContentPreference,
  adultOutputRequested: boolean,
): MediaRecommendationOption {
  const qualityIntent: MediaExecutionRecipe["qualityIntent"] =
    tier === "high-end"
      ? "maximum-quality"
      : tier === "balanced"
        ? "balanced-quality-value"
        : "cost-efficient";

  return {
    tier,
    label,
    provider: candidate.provider,
    model: candidate.model,
    modelName: candidate.modelName,
    estimatedCostUsd: candidate.estimatedCostUsd,
    providerCostEstimateUsd: candidate.providerCostEstimateUsd,
    markupPercent: candidate.markupPercent,
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
    recipe: {
      workflow: workflowFor(plan, Boolean(candidate.referenceBehavior)),
      qualityIntent,
      aspectRatio: plan.aspectRatio,
      resolution: candidate.resolution || plan.resolution,
      durationSeconds: plan.durationSeconds,
      audio: candidate.audio,
      contentConstraint: contentConstraintFor(
        contentPreference,
        adultOutputRequested,
      ),
    },
    adultCapability: candidate.adultCapability || "unknown",
    adultCapabilityNote: candidate.adultCapabilityNote || null,
    scorecard:
      candidate.scorecard ||
      routeScorecardFor(candidate, undefined, Boolean(candidate.referenceBehavior)),
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
  modelVerifications: MediaReferenceModelVerification[] | undefined,
): Candidate | null {
  if (
    model.pricing.status !== "verified-live" ||
    model.pricing.estimatedCostUsd === null ||
    !Number.isFinite(model.pricing.estimatedCostUsd)
  ) {
    return null;
  }

  const persisted = modelVerifications?.find(
    (item) =>
      item.provider === "nous" &&
      item.model === model.model &&
      item.editEndpoint === model.editEndpoint,
  );
  const persistedVerified = persisted?.status === "verified";
  const persistedFailed = persisted?.status === "failed";
  const isSmokeCandidate = isApprovedPremiumReferenceSmokeRoute(
    model.model,
    model.editEndpoint,
  );

  return {
    provider: "nous",
    model: model.model,
    modelName: model.displayName,
    estimatedCostUsd: model.pricing.estimatedCostUsd,
    providerCostEstimateUsd: model.pricing.estimatedCostUsd,
    markupPercent: 0,
    capUsd: nextCent(model.pricing.estimatedCostUsd),
    pricingSource: model.pricing.source,
    resolution: null,
    audio: null,
    executionReady:
      verification?.readyForApprovedSmokeTest === true &&
      !persistedFailed &&
      (persistedVerified || isSmokeCandidate),
    referenceBehavior: model.capabilitySummary,
    verificationNote: persistedVerified
      ? verification?.readyForApprovedSmokeTest
        ? `Verified by successful reference-image generation on this profile${persisted.verifiedAt ? ` on ${new Date(persisted.verifiedAt).toLocaleDateString("en-US")}` : ""}. Current Nous transport checks also passed, so this route is ready for normal use.`
        : "This model was previously verified by a successful reference-image generation, but the current Nous transport or attachment checks are not ready."
      : persistedFailed
        ? `A previous verification attempt for this exact edit endpoint failed, so it remains blocked.${persisted.failureReason ? ` Last failure: ${persisted.failureReason}` : ""}`
        : verification
          ? verification.readyForApprovedSmokeTest
            ? isSmokeCandidate
              ? "Transport is verified. This model is currently approved for a one-shot premium reference smoke test. Selecting it permits one capped generation attempt with no automatic retry or fallback; that first real gateway response will verify this exact edit endpoint."
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
  referenceModelVerifications?: MediaReferenceModelVerification[];
  contentPreference?: MediaContentPreference;
  adultCapabilityEvidence?: MediaAdultCapabilityEvidence[];
  benchmarkEvidence?: MediaBenchmarkEvidence[];
  adultOutputRequested?: boolean;
  adultContentClass?: MediaAdultContentClass;
  cooperativeManagedOpenRouter?: boolean;
}) {
  const { plan, openRouterCatalog, currentCapUsd } = input;
  const contentPreference = input.contentPreference || "sfw_only";
  const adultContentClass: MediaAdultContentClass =
    input.adultContentClass ||
    (input.adultOutputRequested ? "adult_non_explicit" : "sfw");
  const adultOutputRequested = adultContentClass !== "sfw";
  const candidates: Candidate[] = [];
  const registryAvailability = await availableModelRegistryRoutes({
    providers: ["openrouter", "nous", "cooperative-local"],
    routeKinds: ["image", "image-edit", "video"],
    includeNonExecutable: true,
    maxAgeHours: 36,
  }).catch(() => ({
    authoritative: false,
    latestCompletedScanAt: null,
    coverage: new Set<string>(),
    keys: new Set<string>(),
    routes: [],
  }));
  const requestShape = {
    durationSeconds: plan.durationSeconds,
    aspectRatio: plan.aspectRatio,
    resolution: plan.resolution,
    audio: plan.audio,
  };

  const openRouterPool =
    (plan.kind === "video"
      ? openRouterCatalog?.video || []
      : input.requiresReferenceImage
        ? (openRouterCatalog?.image || []).filter(
            (model) =>
              (model.minInputReferences ?? 0) > 0 ||
              model.inputModalities.some(
                (modality) => modality.toLowerCase() === "image",
              ),
          )
        : openRouterCatalog?.image || []
    ).filter((model) =>
      registryRouteEligible(registryAvailability, {
        provider: "openrouter",
        model: model.id,
        routeKind: plan.kind === "video" ? "video" : "image",
      }),
    );
  const exactOpenRouter = openRouterPool.filter((model) =>
    supportsExactRequest(model, plan),
  );
  const openRouterQualityByModel = new Map<string, number>();
  for (const level of [4, 3, 2, 1, 0] as const) {
    const recommended = exactOpenRouter.length
      ? recommendedForRequest(exactOpenRouter, level, requestShape)
      : null;
    if (recommended && !openRouterQualityByModel.has(recommended.id)) {
      openRouterQualityByModel.set(recommended.id, level);
    }
  }

  for (const model of exactOpenRouter) {
    const estimatedCostUsd = estimateOpenRouterMediaCostUsd(model, {
      durationSeconds: plan.durationSeconds,
      resolution: plan.resolution,
      audio: plan.audio,
    });
    if (estimatedCostUsd === null || !Number.isFinite(estimatedCostUsd)) continue;

    const costResolution = resolveMediaRequestCost({
      provider: "openrouter",
      model: model.id,
      request: plan,
      pricing: {
        unit: "request",
        estimatedCostUsd,
        pricingSource: openRouterCatalog?.source || "openrouter-live",
        free: model.free,
      },
      costBearer: model.free
        ? "free"
        : input.cooperativeManagedOpenRouter
          ? "cooperative"
          : "user-connected",
    });
    if (
      !costResolution.bounded ||
      costResolution.providerCostUsd === null ||
      costResolution.capCostUsd === null
    ) {
      continue;
    }

    candidates.push({
      provider: "openrouter",
      model: model.id,
      modelName: model.name || model.id,
      estimatedCostUsd: costResolution.capCostUsd,
      providerCostEstimateUsd: costResolution.providerCostUsd,
      markupPercent: costResolution.markupPercent,
      capUsd: nextCent(costResolution.capCostUsd),
      pricingSource: costResolution.pricingSource,
      resolution: plan.resolution,
      audio: plan.kind === "video" ? plan.audio : null,
      qualityLevel: openRouterQualityByModel.get(model.id) ?? (model.free ? 0 : 2),
      executionReady: true,
      referenceBehavior: input.requiresReferenceImage
        ? "Uses the attached reference image through OpenRouter image editing (input references)."
        : null,
      verificationNote: input.requiresReferenceImage
        ? "OpenRouter reports image input support for this generation model; CoOperative passes the attachment through a short-lived signed URL."
        : null,
      editEndpoint: null,
      costResolution,
    });
  }

  const nousCatalog = await nousManagedMediaCatalog();

  if (plan.kind === "video" && plan.durationSeconds) {
    for (const model of nousCatalog.videoModels || []) {
      if (
        !model.executionReady ||
        !registryRouteEligible(registryAvailability, {
          provider: "nous",
          model: model.model,
          routeKind: "video",
        })
      ) {
        continue;
      }

      if (
        model.minDurationSeconds !== null &&
        plan.durationSeconds < model.minDurationSeconds
      ) {
        continue;
      }
      if (
        model.maxDurationSeconds !== null &&
        plan.durationSeconds > model.maxDurationSeconds
      ) {
        continue;
      }
      if (
        plan.aspectRatio &&
        model.aspectRatios.length > 0 &&
        !model.aspectRatios.some(
          (value) => value.toLowerCase() === plan.aspectRatio?.toLowerCase(),
        )
      ) {
        continue;
      }
      if (
        plan.resolution &&
        model.resolutions.length > 0 &&
        !model.resolutions.some((value) =>
          equivalentVideoResolution(value, plan.resolution),
        )
      ) {
        continue;
      }

      if (model.audioMode === "native" && plan.audio === false) {
        continue;
      }
      const requestedAudio =
        model.audioMode === "native"
          ? true
          : plan.audio ?? false;
      if (requestedAudio && !model.audioSupported) continue;

      const pricedResolutions = Object.keys(model.rates).filter(
        (value) => value !== "default",
      );
      const resolutionCandidates: Array<string | null> = plan.resolution
        ? [plan.resolution.toLowerCase()]
        : pricedResolutions.length
          ? pricedResolutions
          : model.resolutions.length
            ? model.resolutions
            : [null];

      for (const resolution of resolutionCandidates) {
        const costResolution = resolveMediaRequestCost({
          provider: "nous",
          model: model.model,
          request: {
            ...plan,
            resolution,
            audio: requestedAudio,
          },
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

        candidates.push({
          provider: "nous",
          model: model.model,
          modelName: model.displayName,
          estimatedCostUsd: costResolution.capCostUsd,
          providerCostEstimateUsd: costResolution.providerCostUsd,
          markupPercent: costResolution.markupPercent,
          capUsd: nextCent(costResolution.capCostUsd),
          pricingSource: costResolution.pricingSource,
          resolution,
          audio: requestedAudio,
          qualityLevel: model.minLevel,
          executionReady: true,
          referenceBehavior: null,
          verificationNote: model.pricingNote,
          editEndpoint: null,
          costResolution,
        });
      }
    }
  }

  if (plan.kind === "image") {
    if (input.requiresReferenceImage) {
      const referenceCatalog = await discoverNousReferenceImageModels();
      for (const model of referenceCatalog.models) {
        const candidate = discoveredReferenceCandidate(
          model,
          input.referenceVerification,
          input.referenceModelVerifications,
        );
        if (candidate) candidates.push(candidate);
      }
    }

    if (!input.requiresReferenceImage) {
      for (const model of nousCatalog.image) {
        if (
          !registryRouteEligible(registryAvailability, {
            provider: "nous",
            model: model.model,
            routeKind: "image",
          })
        ) {
          continue;
        }
        const costResolution = resolveMediaRequestCost({
          provider: "nous",
          model: model.model,
          request: plan,
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

        candidates.push({
          provider: "nous",
          model: model.model,
          modelName: model.displayName || model.model.replace(/^fal-ai\//, ""),
          estimatedCostUsd: costResolution.capCostUsd,
          providerCostEstimateUsd: costResolution.providerCostUsd,
          markupPercent: costResolution.markupPercent,
          capUsd: nextCent(costResolution.capCostUsd),
          pricingSource: costResolution.pricingSource,
          resolution: null,
          audio: null,
          qualityLevel: model.minLevel,
          executionReady: costResolution.bounded,
          referenceBehavior: null,
          verificationNote: null,
          editEndpoint: null,
          costResolution,
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
            providerCostEstimateUsd: 0,
            markupPercent: 0,
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
            providerCostEstimateUsd: 0,
            markupPercent: 0,
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
            providerCostEstimateUsd: 0,
            markupPercent: 0,
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
          modelName:
            adultContentClass === "adult_explicit"
              ? "Owned Local Quality · Real3D NSFW XL"
              : "Owned Local Quality · SSD-1B",
          estimatedCostUsd: 0,
          providerCostEstimateUsd: 0,
          markupPercent: 0,
          capUsd: 0,
          pricingSource: "owned-local",
          resolution: null,
          audio: null,
          qualityLevel: adultContentClass === "adult_explicit" ? 4 : 2,
          executionReady: true,
          referenceBehavior: null,
          verificationNote:
            adultContentClass === "adult_explicit"
              ? "Owned text-only route. The server-derived explicit content mode switches the worker to the owned Real3D NSFW XL checkpoint and rejects reference/identity inputs."
              : "Owned local quality image execution is already wired.",
          editEndpoint: null,
        });
      }
    }
  }

  const registryTaskType =
    plan.kind === "video"
      ? "video-generation"
      : input.requiresReferenceImage
        ? "image-reference"
        : "image-generation";

  const enriched = candidates.map((candidate) => {
    const adultEnriched = withAdultCapability(
      candidate,
      input.adultCapabilityEvidence,
      adultContentClass,
    );
    const scorecard = routeScorecardFor(
      adultEnriched,
      input.benchmarkEvidence,
      Boolean(input.requiresReferenceImage),
    );
    const registryScore = registryTaskScore(registryAvailability, {
      provider: candidate.provider,
      model: candidate.model,
      endpoint: candidate.editEndpoint || "",
      routeKind:
        plan.kind === "video"
          ? "video"
          : candidate.editEndpoint
            ? "image-edit"
            : "image",
      taskType: registryTaskType,
    });

    return {
      ...adultEnriched,
      scorecard: {
        ...scorecard,
        registryPerformanceScore: registryScore?.performance ?? null,
        registryCostEfficiencyScore: registryScore?.costEfficiency ?? null,
        registryOverallValueScore: registryScore?.overallValue ?? null,
        registryConfidence: registryScore?.confidence ?? null,
      },
    };
  });
  if (adultOutputRequested && contentPreference === "sfw_only") {
    return {
      options: [] as MediaRecommendationOption[],
      fetchedAt: new Date().toISOString(),
      contentPreference,
      requirementBlocked: false,
      explicitVerificationBlocked: false,
      sfwConflict: true,
    };
  }

  const preferenceEligible = !adultOutputRequested
    ? enriched
    : adultContentClass === "adult_explicit"
      ? enriched.filter((candidate) => candidate.adultCapability === "verified")
      : contentPreference === "require_adult_capable"
        ? enriched.filter((candidate) => candidate.adultCapability === "verified")
        : enriched.filter((candidate) => candidate.adultCapability !== "blocked");

  const deduped = [
    ...new Map(
      preferenceEligible.map((candidate) => [candidateKey(candidate), candidate]),
    ).values(),
  ].sort(
    (a, b) =>
      a.estimatedCostUsd - b.estimatedCostUsd ||
      configurationQualityScore(b, contentPreference, adultOutputRequested) -
        configurationQualityScore(a, contentPreference, adultOutputRequested) ||
      a.modelName.localeCompare(b.modelName),
  );

  if (!deduped.length) {
    return {
      options: [] as MediaRecommendationOption[],
      fetchedAt: new Date().toISOString(),
      contentPreference,
      requirementBlocked:
        adultOutputRequested && contentPreference === "require_adult_capable",
      explicitVerificationBlocked:
        adultContentClass === "adult_explicit",
      sfwConflict: false,
    };
  }

  const low = deduped[0];
  let high = [...deduped].sort(
    (a, b) =>
      configurationQualityScore(b, contentPreference, adultOutputRequested) -
        configurationQualityScore(a, contentPreference, adultOutputRequested) ||
      b.estimatedCostUsd - a.estimatedCostUsd,
  )[0];

  if (candidateKey(high) === candidateKey(low) && deduped.length > 1) {
    high =
      [...deduped]
        .filter((candidate) => candidateKey(candidate) !== candidateKey(low))
        .sort(
          (a, b) =>
            configurationQualityScore(b, contentPreference, adultOutputRequested) -
              configurationQualityScore(a, contentPreference, adultOutputRequested) ||
            b.estimatedCostUsd - a.estimatedCostUsd,
        )[0] || high;
  }

  const excluded = new Set([candidateKey(low), candidateKey(high)]);
  const midpoint = (low.estimatedCostUsd + high.estimatedCostUsd) / 2;
  const availableBalanced = deduped.filter(
    (candidate) => !excluded.has(candidateKey(candidate)),
  );
  const qualityScores = availableBalanced.map((candidate) =>
    configurationQualityScore(candidate, contentPreference, adultOutputRequested),
  );
  const qualityMin = qualityScores.length ? Math.min(...qualityScores) : 0;
  const qualityMax = qualityScores.length ? Math.max(...qualityScores) : 0;
  const costSpan = Math.max(
    0.000001,
    Math.abs(high.estimatedCostUsd - low.estimatedCostUsd),
  );

  let balanced =
    [...availableBalanced].sort((a, b) => {
      const score = (candidate: Candidate) => {
        const quality = configurationQualityScore(candidate, contentPreference, adultOutputRequested);
        const normalizedQuality =
          qualityMax > qualityMin
            ? (quality - qualityMin) / (qualityMax - qualityMin)
            : 1;
        const midpointFit = Math.max(
          0,
          1 - Math.abs(candidate.estimatedCostUsd - midpoint) / costSpan,
        );
        const registryValue =
          (candidate.scorecard?.registryOverallValueScore ?? 50) / 100;
        const registryConfidence =
          candidate.scorecard?.registryConfidence ?? 0;
        const evidenceValue =
          registryValue * registryConfidence +
          0.5 * (1 - registryConfidence);
        return (
          normalizedQuality * 0.5 +
          midpointFit * 0.25 +
          evidenceValue * 0.25
        );
      };
      return (
        score(b) - score(a) ||
        Math.abs(a.estimatedCostUsd - midpoint) -
          Math.abs(b.estimatedCostUsd - midpoint)
      );
    })[0] ||
    distinctCandidate(deduped, new Set([candidateKey(low)]), midpoint) ||
    high;

  if (candidateKey(balanced) === candidateKey(low) && deduped.length > 1) {
    balanced = high;
  }

  const options = [
    asOption(
      "high-end",
      "High-end",
      high,
      currentCapUsd,
      plan,
      contentPreference,
      adultOutputRequested,
    ),
    asOption(
      "lowest-cost",
      "Lowest cost",
      low,
      currentCapUsd,
      plan,
      contentPreference,
      adultOutputRequested,
    ),
    asOption(
      "balanced",
      "Balanced",
      balanced,
      currentCapUsd,
      plan,
      contentPreference,
      adultOutputRequested,
    ),
  ];

  return {
    options,
    fetchedAt: new Date().toISOString(),
    registryAvailability: {
      authoritative: registryAvailability.authoritative,
      latestCompletedScanAt: registryAvailability.latestCompletedScanAt,
    },
    contentPreference,
    requirementBlocked: false,
    explicitVerificationBlocked: false,
    sfwConflict: false,
  };
}

export function bestMediaRecommendationWithinCap(
  options: MediaRecommendationOption[],
  currentCapUsd: number,
) {
  return (
    [...options]
      .filter(
        (option) =>
          option.executionReady !== false &&
          option.capUsd <= currentCapUsd + 0.000001,
      )
      .sort(
        (a, b) =>
          (b.scorecard?.registryOverallValueScore ??
            b.scorecard?.qualityScore ??
            0) -
            (a.scorecard?.registryOverallValueScore ??
              a.scorecard?.qualityScore ??
              0) ||
          (b.scorecard?.registryConfidence ?? 0) -
            (a.scorecard?.registryConfidence ?? 0) ||
          (b.scorecard?.qualityScore ?? 0) - (a.scorecard?.qualityScore ?? 0) ||
          (b.scorecard?.benchmarkCoverage ?? 0) -
            (a.scorecard?.benchmarkCoverage ?? 0) ||
          a.estimatedCostUsd - b.estimatedCostUsd,
      )[0] || null
  );
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
