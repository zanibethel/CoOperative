import "server-only";

import { paidAiPriceQuote } from "@/lib/billing/paid-ai-pricing";
import type { MediaRequestKind, MediaRequestPlan } from "@/lib/inference/media-request";

export type MediaCostBearer = "cooperative" | "user-connected" | "free";
export type MediaCostPricingMode =
  | "free"
  | "fixed-request"
  | "per-image"
  | "per-megapixel"
  | "per-second"
  | "per-second-resolution"
  | "unbounded";

export type MediaCostResolution = {
  bounded: boolean;
  provider: string;
  model: string;
  kind: MediaRequestKind;
  pricingMode: MediaCostPricingMode;
  pricingUnit: string;
  pricingSource: string;
  checkedAt: string;
  confidence: "exact" | "conservative" | "unbounded";
  providerCostUsd: number | null;
  capCostUsd: number | null;
  userQuoteUsd: number | null;
  markupPercent: number;
  reason: string;
  breakdown: {
    imageCount?: number;
    width?: number;
    height?: number;
    rawMegapixels?: number;
    billedMegapixels?: number;
    rateUsdPerMegapixel?: number;
    durationSeconds?: number;
    resolution?: string | null;
    audio?: boolean | null;
    rateUsdPerSecond?: number;
    fixedProviderEstimateUsd?: number;
  };
};

export type MediaCostPricingInput = {
  unit?: unknown;
  estimatedCostUsd?: unknown;
  minUnitCostUsd?: unknown;
  maxUnitCostUsd?: unknown;
  rates?: unknown;
  pricingSource?: unknown;
  source?: unknown;
  free?: unknown;
};

export type ResolveMediaRequestCostInput = {
  provider: string;
  model: string;
  request: Pick<
    MediaRequestPlan,
    "kind" | "aspectRatio" | "durationSeconds" | "resolution" | "audio"
  >;
  pricing: MediaCostPricingInput;
  costBearer?: MediaCostBearer;
  imageCount?: number;
};

const FAL_BILLING_MEGAPIXEL_PIXELS = 1024 * 1024;

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveCount(value: number | undefined, fallback = 1) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizedUnit(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sourceLabel(pricing: MediaCostPricingInput) {
  const value =
    typeof pricing.pricingSource === "string"
      ? pricing.pricingSource
      : typeof pricing.source === "string"
        ? pricing.source
        : "";
  return value.trim() || "registry-pricing";
}

function imageDimensions(aspectRatio: MediaRequestPlan["aspectRatio"]) {
  // Hermes v2026.9.24 maps image-generation aspect buckets to FAL's standard
  // presets for FLUX/Z-Image/Qwen/Recraft/Ideogram. These preset dimensions are
  // also the billing dimensions used by the request-cost resolver.
  if (aspectRatio === "16:9") return { width: 1024, height: 576 };
  if (aspectRatio === "9:16") return { width: 576, height: 1024 };
  return { width: 1024, height: 1024 };
}

function rateForVideoResolution(
  rates: unknown,
  resolution: string | null,
  audio: boolean,
) {
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) return null;
  const rows = rates as Record<string, unknown>;
  const key = (resolution || "").toLowerCase();
  const row = key ? rows[key] : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;

  const record = row as Record<string, unknown>;
  return finiteNumber(audio ? record.withAudio : record.withoutAudio);
}

function quotedCost(
  providerCostUsd: number,
  costBearer: MediaCostBearer,
) {
  if (costBearer === "free" || providerCostUsd <= 0) {
    return {
      capCostUsd: 0,
      userQuoteUsd: 0,
      markupPercent: 0,
    };
  }

  if (costBearer === "cooperative") {
    const quote = paidAiPriceQuote(providerCostUsd);
    return {
      capCostUsd: quote.userQuoteUsd,
      userQuoteUsd: quote.userQuoteUsd,
      markupPercent: quote.markupPercent,
    };
  }

  return {
    capCostUsd: providerCostUsd,
    userQuoteUsd: 0,
    markupPercent: 0,
  };
}

function boundedResult(input: {
  provider: string;
  model: string;
  request: ResolveMediaRequestCostInput["request"];
  pricingMode: MediaCostPricingMode;
  pricingUnit: string;
  pricingSource: string;
  confidence: "exact" | "conservative";
  providerCostUsd: number;
  costBearer: MediaCostBearer;
  reason: string;
  breakdown: MediaCostResolution["breakdown"];
}): MediaCostResolution {
  const providerCostUsd = Math.max(0, input.providerCostUsd);
  const quote = quotedCost(providerCostUsd, input.costBearer);

  return {
    bounded: true,
    provider: input.provider,
    model: input.model,
    kind: input.request.kind,
    pricingMode: input.pricingMode,
    pricingUnit: input.pricingUnit,
    pricingSource: input.pricingSource,
    checkedAt: new Date().toISOString(),
    confidence: input.confidence,
    providerCostUsd,
    capCostUsd: quote.capCostUsd,
    userQuoteUsd: quote.userQuoteUsd,
    markupPercent: quote.markupPercent,
    reason: input.reason,
    breakdown: input.breakdown,
  };
}

function unboundedResult(
  input: ResolveMediaRequestCostInput,
  reason: string,
): MediaCostResolution {
  return {
    bounded: false,
    provider: input.provider,
    model: input.model,
    kind: input.request.kind,
    pricingMode: "unbounded",
    pricingUnit: normalizedUnit(input.pricing.unit) || "unknown",
    pricingSource: sourceLabel(input.pricing),
    checkedAt: new Date().toISOString(),
    confidence: "unbounded",
    providerCostUsd: null,
    capCostUsd: null,
    userQuoteUsd: null,
    markupPercent: 0,
    reason,
    breakdown: {},
  };
}

export function resolveMediaRequestCost(
  input: ResolveMediaRequestCostInput,
): MediaCostResolution {
  const costBearer = input.costBearer || "user-connected";
  const pricingSource = sourceLabel(input.pricing);
  const unit = normalizedUnit(input.pricing.unit);
  const imageCount = positiveCount(input.imageCount);

  if (input.pricing.free === true || costBearer === "free") {
    return boundedResult({
      provider: input.provider,
      model: input.model,
      request: input.request,
      pricingMode: "free",
      pricingUnit: "free",
      pricingSource,
      confidence: "exact",
      providerCostUsd: 0,
      costBearer: "free",
      reason: "The selected route has zero upstream provider cost.",
      breakdown: {
        ...(input.request.kind === "image" ? { imageCount } : {}),
      },
    });
  }

  const estimate =
    finiteNumber(input.pricing.estimatedCostUsd) ??
    finiteNumber(input.pricing.maxUnitCostUsd) ??
    finiteNumber(input.pricing.minUnitCostUsd);

  if (unit === "request" || unit === "fixed-request") {
    if (estimate === null || estimate < 0) {
      return unboundedResult(
        input,
        "The request-level provider estimate is missing or invalid.",
      );
    }
    return boundedResult({
      provider: input.provider,
      model: input.model,
      request: input.request,
      pricingMode: "fixed-request",
      pricingUnit: "request",
      pricingSource,
      confidence: "exact",
      providerCostUsd: estimate,
      costBearer,
      reason:
        "The provider-specific estimator returned a bounded cost for the complete request.",
      breakdown: { fixedProviderEstimateUsd: estimate },
    });
  }

  if (input.request.kind === "image") {
    if (unit === "megapixel" || unit === "mp") {
      if (estimate === null || estimate < 0) {
        return unboundedResult(
          input,
          "The route is priced per megapixel but has no usable unit rate.",
        );
      }

      const { width, height } = imageDimensions(input.request.aspectRatio);
      const pixels = width * height;
      const rawMegapixels = pixels / FAL_BILLING_MEGAPIXEL_PIXELS;
      // FAL-style MP billing is conservatively rounded to whole 1024×1024
      // billing megapixels. This intentionally avoids under-quoting landscape
      // and portrait presets below one billing MP.
      const billedMegapixels = Math.max(1, Math.ceil(rawMegapixels - 1e-12));
      const providerCostUsd =
        estimate * billedMegapixels * imageCount;

      return boundedResult({
        provider: input.provider,
        model: input.model,
        request: input.request,
        pricingMode: "per-megapixel",
        pricingUnit: "megapixel",
        pricingSource,
        confidence: "conservative",
        providerCostUsd,
        costBearer,
        reason:
          "The helper resolved the Hermes/FAL aspect preset to pixels and conservatively rounded the output to whole billing megapixels.",
        breakdown: {
          imageCount,
          width,
          height,
          rawMegapixels,
          billedMegapixels,
          rateUsdPerMegapixel: estimate,
        },
      });
    }

    if (unit === "image" || unit === "per-image") {
      if (estimate === null || estimate < 0) {
        return unboundedResult(
          input,
          "The route is priced per image but has no usable per-image amount.",
        );
      }
      return boundedResult({
        provider: input.provider,
        model: input.model,
        request: input.request,
        pricingMode: "per-image",
        pricingUnit: "image",
        pricingSource,
        confidence: "exact",
        providerCostUsd: estimate * imageCount,
        costBearer,
        reason:
          "The provider catalog supplies a bounded per-image price.",
        breakdown: {
          imageCount,
          fixedProviderEstimateUsd: estimate,
        },
      });
    }
  }

  if (input.request.kind === "video") {
    const durationSeconds = input.request.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) {
      return unboundedResult(
        input,
        "Video pricing cannot be bounded until request duration is known.",
      );
    }

    const audio = input.request.audio ?? false;
    const rateByResolution = rateForVideoResolution(
      input.pricing.rates,
      input.request.resolution,
      audio,
    );
    if (rateByResolution !== null && rateByResolution >= 0) {
      return boundedResult({
        provider: input.provider,
        model: input.model,
        request: input.request,
        pricingMode: "per-second-resolution",
        pricingUnit: "second",
        pricingSource,
        confidence: "exact",
        providerCostUsd: durationSeconds * rateByResolution,
        costBearer,
        reason:
          "The helper matched duration, resolution, and generated-audio mode to the provider's current per-second rate.",
        breakdown: {
          durationSeconds,
          resolution: input.request.resolution,
          audio,
          rateUsdPerSecond: rateByResolution,
        },
      });
    }

    if (unit === "second" || unit === "per-second") {
      if (estimate === null || estimate < 0) {
        return unboundedResult(
          input,
          "The route is priced per second but has no usable per-second rate.",
        );
      }
      return boundedResult({
        provider: input.provider,
        model: input.model,
        request: input.request,
        pricingMode: "per-second",
        pricingUnit: "second",
        pricingSource,
        confidence: "exact",
        providerCostUsd: durationSeconds * estimate,
        costBearer,
        reason:
          "The helper multiplied the bounded provider rate by the requested video duration.",
        breakdown: {
          durationSeconds,
          resolution: input.request.resolution,
          audio,
          rateUsdPerSecond: estimate,
        },
      });
    }
  }

  if (estimate !== null && estimate >= 0 && !unit) {
    return boundedResult({
      provider: input.provider,
      model: input.model,
      request: input.request,
      pricingMode: "fixed-request",
      pricingUnit: "request",
      pricingSource,
      confidence: "conservative",
      providerCostUsd: estimate,
      costBearer,
      reason:
        "A bounded request estimate exists but the upstream unit is unspecified; the helper treats it conservatively as a complete-request estimate.",
      breakdown: { fixedProviderEstimateUsd: estimate },
    });
  }

  return unboundedResult(
    input,
    "The provider pricing schema cannot yet be converted into a bounded total request cost.",
  );
}
