import "server-only";

import { hermesManagedMediaCatalog } from "@/lib/inference/hermes-managed-catalog";

export type NousManagedMediaKind = "image" | "video";

export type NousManagedMediaChoice = {
  provider: "nous";
  model: string;
  estimatedCostUsd: number;
  qualityLabel: string;
  degradedFromRequestedLevel: boolean;
  executionNote: string;
  pricingSource: string;
  resolution?: string | null;
  audio?: boolean | null;
};

type LiveImageCandidate = {
  minLevel: 1 | 2 | 3 | 4;
  model: string;
  url: string;
  qualityLabel: string;
  pricingUnit: "image" | "megapixel";
  parseCostUsd: (html: string) => number | null;
};

type PixversePricing = {
  fetchedAt: string;
  source: string;
  rates: Record<string, { withoutAudio: number; withAudio: number }>;
};

const CACHE_MS = 15 * 60 * 1000;
const textCache = new Map<string, { at: number; text: string }>();

async function liveText(url: string) {
  const cached = textCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html, text/plain;q=0.9" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Live media pricing returned HTTP ${response.status} for ${url}.`);
    }
    const text = await response.text();
    textCache.set(url, { at: Date.now(), text });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function firstNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

const IMAGE_CANDIDATES: LiveImageCandidate[] = [
  {
    minLevel: 1,
    model: "fal-ai/z-image/turbo",
    url: "https://fal.ai/models/fal-ai/z-image/turbo",
    qualityLabel: "economy",
    pricingUnit: "megapixel",
    parseCostUsd: (html) =>
      firstNumber(html, [
        /cost\s+\$([0-9.]+)\s+per\s+megapixel/i,
        /\$([0-9.]+)\s*\/\s*MP/i,
      ]),
  },
  {
    minLevel: 2,
    model: "fal-ai/qwen-image",
    url: "https://fal.ai/models/fal-ai/qwen-image",
    qualityLabel: "balanced",
    pricingUnit: "megapixel",
    parseCostUsd: (html) =>
      firstNumber(html, [
        /cost\s+\$([0-9.]+)\s+per\s+megapixel/i,
        /\$([0-9.]+)\s*\/\s*MP/i,
      ]),
  },
  {
    minLevel: 3,
    model: "fal-ai/gpt-image-1.5",
    url: "https://fal.ai/models/fal-ai/gpt-image-1.5",
    qualityLabel: "high",
    pricingUnit: "image",
    parseCostUsd: (html) => {
      const mediumSquare = firstNumber(html, [
        /medium quality[^$]*\$([0-9.]+)\s+for\s+1024x1024/i,
      ]);
      if (mediumSquare === null) return null;
      // Reserve a small amount for this model's separately metered prompt/reasoning
      // tokens so the request ceiling remains conservative.
      return mediumSquare + 0.01;
    },
  },
  {
    minLevel: 4,
    model: "fal-ai/nano-banana-pro",
    url: "https://fal.ai/models/fal-ai/nano-banana-pro",
    qualityLabel: "premium",
    pricingUnit: "image",
    parseCostUsd: (html) =>
      firstNumber(html, [
        /cost\s+\$([0-9.]+)\s+per\s+image/i,
        /\$([0-9.]+)\s*\/\s*image/i,
      ]),
  },
];

export async function chooseNousManagedImage(
  requestedLevel: 0 | 1 | 2 | 3 | 4,
  maxSpendUsd: number | null,
): Promise<NousManagedMediaChoice | null> {
  if (requestedLevel === 0) return null;

  const cap =
    maxSpendUsd === null ? Number.POSITIVE_INFINITY : Math.max(0, maxSpendUsd);
  const requestedCandidates = IMAGE_CANDIDATES
    .filter(
      (candidate) =>
        candidate.minLevel <= requestedLevel &&
        candidate.pricingUnit === "image",
    )
    .sort((a, b) => b.minLevel - a.minLevel);

  for (const candidate of requestedCandidates) {
    try {
      const html = await liveText(candidate.url);
      const liveCost = candidate.parseCostUsd(html);
      if (liveCost === null || liveCost > cap) continue;

      return {
        provider: "nous",
        model: candidate.model,
        estimatedCostUsd: liveCost,
        qualityLabel: candidate.qualityLabel,
        degradedFromRequestedLevel: candidate.minLevel < requestedLevel,
        pricingSource: candidate.url,
        executionNote:
          "Nous Portal managed image generation is preferred. CoOperative verified current upstream pricing before approving the paid tool call.",
      };
    } catch {
      // Never spend from a stale hard-coded estimate. If the live source is
      // unavailable, let routing continue to local/free or another live catalog.
    }
  }
  return null;
}

const PIXVERSE_URL = "https://fal.ai/models/fal-ai/pixverse/v6/text-to-video";
const PIXVERSE_LLM_URL = `${PIXVERSE_URL}/llms.txt`;
const LEVEL_RESOLUTION: Record<1 | 2 | 3 | 4, string[]> = {
  1: ["360p"],
  2: ["540p", "360p"],
  3: ["720p", "540p", "360p"],
  4: ["1080p", "720p", "540p", "360p"],
};

async function livePixversePricing(): Promise<PixversePricing | null> {
  for (const source of [PIXVERSE_LLM_URL, PIXVERSE_URL]) {
    try {
      const html = await liveText(source);
      const rates: PixversePricing["rates"] = {};
      for (const resolution of ["360p", "540p", "720p", "1080p"]) {
        const escaped = resolution.replace("p", "p");
        const row = html.match(
          new RegExp(
            `For\\s+${escaped}[^$]*\\$([0-9.]+)\\s+per\\s+second\\s+without\\s+audio[^$]*\\$([0-9.]+)\\s+per\\s+second\\s+with\\s+audio`,
            "i",
          ),
        );
        if (!row) continue;
        const withoutAudio = Number(row[1]);
        const withAudio = Number(row[2]);
        if (Number.isFinite(withoutAudio) && Number.isFinite(withAudio)) {
          rates[resolution] = { withoutAudio, withAudio };
        }
      }
      if (!Object.keys(rates).length) continue;
      return {
        fetchedAt: new Date().toISOString(),
        source,
        rates,
      };
    } catch {
      // Try the next live fal source. Never substitute a stale hard-coded price.
    }
  }
  return null;
}

export async function chooseNousManagedVideo(
  requestedLevel: 0 | 1 | 2 | 3 | 4,
  maxSpendUsd: number | null,
  durationSeconds: number | null,
  requestedResolution: string | null = null,
  requestedAudio: boolean | null = null,
): Promise<NousManagedMediaChoice | null> {
  if (requestedLevel === 0 || !durationSeconds) return null;

  const pricing = await livePixversePricing();
  if (!pricing) return null;

  const cap =
    maxSpendUsd === null ? Number.POSITIVE_INFINITY : Math.max(0, maxSpendUsd);
  const resolutionOrder = requestedResolution
    ? [requestedResolution.toLowerCase()]
    : LEVEL_RESOLUTION[requestedLevel];
  const audio = requestedAudio ?? false;

  for (const resolution of resolutionOrder) {
    const rate = pricing.rates[resolution];
    if (!rate) continue;
    const estimatedCostUsd =
      durationSeconds * (audio ? rate.withAudio : rate.withoutAudio);
    if (estimatedCostUsd > cap) continue;

    const levelMax = LEVEL_RESOLUTION[requestedLevel][0];
    return {
      provider: "nous",
      model: "pixverse-v6",
      estimatedCostUsd,
      qualityLabel: `${resolution} ${audio ? "with audio" : "no audio"}`,
      degradedFromRequestedLevel:
        Boolean(requestedResolution && requestedResolution.toLowerCase() !== resolution) ||
        resolution !== levelMax,
      pricingSource: pricing.source,
      resolution,
      audio,
      executionNote:
        "Nous Portal managed PixVerse is preferred. Duration, resolution, and generated-audio pricing were checked live before the generation call.",
    };
  }

  return null;
}

export async function affordableVideoSuggestion(
  durationSeconds: number | null,
  maxSpendUsd: number | null,
  requestedResolution: string | null = null,
  requestedAudio: boolean | null = null,
) {
  if (!durationSeconds || maxSpendUsd === null) return null;
  const pricing = await livePixversePricing();
  if (!pricing) return null;

  const audio = requestedAudio ?? false;
  const requestedRate =
    (requestedResolution && pricing.rates[requestedResolution.toLowerCase()]) ||
    pricing.rates["360p"];
  if (!requestedRate) return null;

  const requestedCost =
    durationSeconds * (audio ? requestedRate.withAudio : requestedRate.withoutAudio);

  const resolutionOrder = ["1080p", "720p", "540p", "360p"];
  const bestVariant = (withAudio: boolean) => {
    let best:
      | {
          durationSeconds: number;
          resolution: string;
          audio: boolean;
          estimatedCostUsd: number;
          rateUsdPerSecond: number;
        }
      | null = null;

    for (const resolution of resolutionOrder) {
      const rates = pricing.rates[resolution];
      if (!rates) continue;
      const rate = withAudio ? rates.withAudio : rates.withoutAudio;
      if (!Number.isFinite(rate) || rate <= 0) continue;

      const affordableSeconds = Math.min(
        durationSeconds,
        Math.floor((maxSpendUsd + 1e-9) / rate),
      );
      if (affordableSeconds < 1) continue;

      const candidate = {
        durationSeconds: affordableSeconds,
        resolution,
        audio: withAudio,
        estimatedCostUsd: affordableSeconds * rate,
        rateUsdPerSecond: rate,
      };

      if (
        !best ||
        candidate.durationSeconds > best.durationSeconds ||
        (candidate.durationSeconds === best.durationSeconds &&
          resolutionOrder.indexOf(candidate.resolution) <
            resolutionOrder.indexOf(best.resolution))
      ) {
        best = candidate;
      }
    }

    return best;
  };

  const bestWithinBudget = bestVariant(audio);
  const bestWithoutAudio = audio ? bestVariant(false) : null;

  return {
    affordableSeconds: bestWithinBudget?.durationSeconds || 0,
    minimumRequestedBudget: requestedCost,
    rateUsdPerSecond: bestWithinBudget?.rateUsdPerSecond || null,
    requestedResolution: requestedResolution || "360p",
    suggestedResolution: bestWithinBudget?.resolution || null,
    audio,
    bestWithinBudget,
    bestWithoutAudio,
    pricingSource: pricing.source,
  };
}


export async function nousManagedMediaCatalog() {
  const [hermesCatalog, liveCurated, pixverse] = await Promise.all([
    hermesManagedMediaCatalog().catch(() => null),
    Promise.all(
      IMAGE_CANDIDATES.map(async (candidate) => {
        try {
          const html = await liveText(candidate.url);
          const estimatedCostUsd = candidate.parseCostUsd(html);
          return estimatedCostUsd === null
            ? null
            : {
                model: candidate.model,
                displayName: candidate.model.replace(/^fal-ai\//, ""),
                qualityLabel: candidate.qualityLabel,
                minLevel: candidate.minLevel,
                estimatedCostUsd,
                pricingSource: candidate.url,
                pricingApproximate: false,
                pricingUnit: candidate.pricingUnit,
                executionReady: candidate.pricingUnit === "image" || candidate.pricingUnit === "megapixel",
                editEndpoint: null as string | null,
                maxReferenceImages: 0,
              };
        } catch {
          return null;
        }
      }),
    ),
    livePixversePricing(),
  ]);

  const imageByModel = new Map<
    string,
    {
      model: string;
      displayName: string;
      qualityLabel: string;
      minLevel: 1 | 2 | 3 | 4;
      estimatedCostUsd: number;
      pricingSource: string;
      pricingApproximate: boolean;
      pricingUnit: "image" | "megapixel" | "unknown";
      executionReady: boolean;
      editEndpoint: string | null;
      maxReferenceImages: number;
    }
  >();

  const hermesImageSource = hermesCatalog?.imageSource || "";
  for (const model of hermesCatalog?.image || []) {
    if (
      model.estimatedCostUsd === null ||
      !Number.isFinite(model.estimatedCostUsd) ||
      model.estimatedCostUsd < 0
    ) {
      continue;
    }
    imageByModel.set(model.id, {
      model: model.id,
      displayName: model.displayName,
      qualityLabel:
        model.qualityLevel === 1
          ? "economy"
          : model.qualityLevel === 2
            ? "balanced"
            : model.qualityLevel === 3
              ? "high"
              : "premium",
      minLevel: model.qualityLevel,
      estimatedCostUsd: model.estimatedCostUsd,
      pricingSource: hermesImageSource,
      pricingApproximate: true,
      pricingUnit: model.pricingUnit,
      executionReady: model.pricingUnit === "image" || model.pricingUnit === "megapixel",
      editEndpoint: model.editEndpoint,
      maxReferenceImages: model.maxReferenceImages,
    });
  }

  // Preserve the stronger live-pricing checks for the routes we already verify
  // directly against fal. These overwrite the release-catalog estimates.
  for (const model of liveCurated) {
    if (!model) continue;
    imageByModel.set(model.model, model);
  }

  const image = [...imageByModel.values()].sort(
    (a, b) =>
      a.estimatedCostUsd - b.estimatedCostUsd ||
      b.minLevel - a.minLevel ||
      a.displayName.localeCompare(b.displayName),
  );

  return {
    fetchedAt: new Date().toISOString(),
    source: hermesCatalog
      ? (`nous-managed+${hermesCatalog.source}` as const)
      : ("nous-managed-live" as const),
    hermesRelease: hermesCatalog?.release || null,
    hermesDiscovery: hermesCatalog
      ? {
          source: hermesCatalog.source,
          imageSource: hermesCatalog.imageSource,
          videoSource: hermesCatalog.videoSource,
          imageCount: hermesCatalog.image.length,
          videoCount: hermesCatalog.video.length,
        }
      : null,
    image,
    video: pixverse
      ? {
          model: "pixverse-v6",
          durationSeconds: { min: 1, max: 15 },
          rates: pixverse.rates,
          pricingSource: pixverse.source,
        }
      : null,
  };
}
