import "server-only";

import {
  hermesManagedMediaCatalog,
  type HermesManagedVideoModel,
} from "@/lib/inference/hermes-managed-catalog";

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


type LiveVideoRate = {
  withoutAudio: number;
  withAudio: number;
};

export type NousManagedVideoModel = {
  model: string;
  displayName: string;
  qualityLabel: string;
  minLevel: 1 | 2 | 3 | 4;
  textEndpoint: string;
  imageEndpoint: string | null;
  rates: Record<string, LiveVideoRate>;
  pricingSource: string;
  pricingApproximate: boolean;
  executionReady: boolean;
  aspectRatios: string[];
  resolutions: string[];
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  audioSupported: boolean;
  audioMode: "none" | "toggle" | "native";
  pricingNote: string;
};

function normalizeFalPricingText(html: string) {
  return html
    .replace(/\\u0024/gi, "$")
    .replace(/&#36;|&#x24;|&dollar;/gi, "$")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalVideoResolution(value: string) {
  return value.trim().toLowerCase();
}

function setVideoRateIfMissing(
  rates: Record<string, LiveVideoRate>,
  resolution: string,
  withoutAudio: number,
  withAudio = withoutAudio,
) {
  const key = canonicalVideoResolution(resolution);
  if (
    rates[key] ||
    !Number.isFinite(withoutAudio) ||
    withoutAudio < 0 ||
    !Number.isFinite(withAudio) ||
    withAudio < 0
  ) {
    return;
  }
  rates[key] = { withoutAudio, withAudio };
}

function parseFalVideoPricing(
  html: string,
  model: HermesManagedVideoModel,
) {
  const text = normalizeFalPricingText(html);
  const rates: Record<string, LiveVideoRate> = {};

  // Kling-style audio toggle: "$0.084 (audio off) or $0.126 (audio on)".
  const audioPair = text.match(
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*\(\s*audio\s+off\s*\)\s*or\s*\$\s*([0-9]+(?:\.[0-9]+)?)\s*\(\s*audio\s+on\s*\)/i,
  );
  if (audioPair) {
    const withoutAudio = Number(audioPair[1]);
    const withAudio = Number(audioPair[2]);
    setVideoRateIfMissing(rates, "default", withoutAudio, withAudio);
  }

  // Resolution first: "720p ... $0.09 per second" or "720p at $0.14/sec".
  const resolutionFirst =
    /\b(360p|480p|540p|720p|768p|1080p|1440p|2160p|2k|4k)\b[^$]{0,100}\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*(?:sec(?:ond)?|s)\b|per\s+second\b)/gi;
  for (const match of text.matchAll(resolutionFirst)) {
    setVideoRateIfMissing(rates, match[1], Number(match[2]));
  }

  // Price first: "$0.08/sec for 480p" / "$0.015 per second at 480p".
  const priceFirst =
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*(?:sec(?:ond)?|s)\b|per\s+second\b)[^$]{0,70}?\b(?:at|for)\s+(360p|480p|540p|720p|768p|1080p|1440p|2160p|2k|4k)\b/gi;
  for (const match of text.matchAll(priceFirst)) {
    setVideoRateIfMissing(rates, match[2], Number(match[1]));
  }

  // Wan-style sentence: "For every second ... $0.068 at 480p, $0.14 at 720p".
  const shortResolutionPrice =
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:at|for)\s+(360p|480p|540p|720p|768p|1080p|1440p|2160p|2k|4k)\b/gi;
  for (const match of text.matchAll(shortResolutionPrice)) {
    const at = match.index ?? 0;
    const context = text.slice(Math.max(0, at - 180), at).toLowerCase();
    if (
      context.includes("every second") ||
      context.includes("per second") ||
      context.includes("second of video")
    ) {
      setVideoRateIfMissing(rates, match[2], Number(match[1]));
    }
  }

  // Flat pricing is only safe when the page explicitly says resolution/audio do
  // not change price, or the Hermes family exposes no resolution choices.
  if (!Object.keys(rates).length) {
    const flat = text.match(
      /(?:charged|costs?|priced(?:\s+at)?)\s*\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*(?:sec(?:ond)?|s)\b|per\s+second\b)/i,
    );
    const explicitlyFlat =
      /regardless\s+of\s+(?:whether\s+)?audio/i.test(text) ||
      /same\s+(?:price|rate)[^.]*(?:resolution|audio)/i.test(text);
    if (
      flat &&
      (explicitlyFlat || model.resolutions.length <= 1)
    ) {
      const rate = Number(flat[1]);
      setVideoRateIfMissing(rates, "default", rate, rate);
    }
  }

  const tokenFormulaPricing =
    /token(?:s| prices| pricing)[^$]{0,120}\$[0-9.]+[^.]{0,160}(?:height|width|duration)/i.test(
      text,
    );
  const audioIncluded =
    /native\s+audio\s+is\s+included|audio\s+is\s+included|audio\s+included/i.test(
      text,
    );

  // For native-audio/no-audio families, or token-formula pricing that does not
  // vary by the audio toggle, one rate safely covers both UI states.
  if (
    model.audioMode !== "toggle" ||
    audioIncluded ||
    tokenFormulaPricing
  ) {
    for (const rate of Object.values(rates)) {
      rate.withAudio = rate.withoutAudio;
    }
  }

  const audioPricingBounded =
    model.audioMode !== "toggle" ||
    audioIncluded ||
    tokenFormulaPricing ||
    Boolean(audioPair);

  const approximate =
    /roughly|approximately|token(?:s| pricing| prices)/i.test(text);

  // Add a conservative buffer whenever the page itself calls the rate an
  // approximation or derives it from tokens. The exact provider usage can be
  // reconciled later, but selection must never depend on an optimistic quote.
  if (approximate) {
    for (const rate of Object.values(rates)) {
      rate.withoutAudio = rate.withoutAudio * 1.05;
      rate.withAudio = rate.withAudio * 1.05;
    }
  }

  return {
    rates,
    audioPricingBounded,
    approximate,
    note: audioPricingBounded
      ? "Live FAL page pricing was normalized into request-level per-second rates."
      : "The live page exposes video pricing but does not bound the audio-toggle price difference.",
  };
}

async function liveHermesVideoPricing(
  model: HermesManagedVideoModel,
): Promise<NousManagedVideoModel | null> {
  if (!model.textEndpoint) return null;

  const pageUrl = `https://fal.ai/models/${model.textEndpoint}`;
  try {
    const html = await liveText(pageUrl);
    const parsed = parseFalVideoPricing(html, model);
    if (!Object.keys(parsed.rates).length) return null;

    const qualityLabel = model.tier === "cheap" ? "balanced" : "premium";
    return {
      model: model.id,
      displayName: model.displayName,
      qualityLabel,
      minLevel: model.tier === "cheap" ? 2 : 4,
      textEndpoint: model.textEndpoint,
      imageEndpoint: model.imageEndpoint,
      rates: parsed.rates,
      pricingSource: pageUrl,
      pricingApproximate: parsed.approximate,
      executionReady: parsed.audioPricingBounded,
      aspectRatios: model.aspectRatios,
      resolutions: model.resolutions.map(canonicalVideoResolution),
      minDurationSeconds: model.minDurationSeconds,
      maxDurationSeconds: model.maxDurationSeconds,
      audioSupported: model.audioSupported,
      audioMode: model.audioMode,
      pricingNote: parsed.note,
    };
  } catch {
    return null;
  }
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
  const hermesCatalog = await hermesManagedMediaCatalog().catch(() => null);
  const [liveCurated, pixverse, liveVideoModels] = await Promise.all([
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
    Promise.all(
      (hermesCatalog?.video || []).map((model) =>
        liveHermesVideoPricing(model),
      ),
    ),
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
    videoModels: [
      ...new Map(
        [
          ...liveVideoModels.filter(
            (model): model is NousManagedVideoModel => Boolean(model),
          ),
          ...(pixverse
            ? [{
                model: "pixverse-v6",
                displayName: "PixVerse V6",
                qualityLabel: "balanced",
                minLevel: 2 as const,
                textEndpoint: "fal-ai/pixverse/v6/text-to-video",
                imageEndpoint: "fal-ai/pixverse/v6/image-to-video",
                rates: pixverse.rates,
                pricingSource: pixverse.source,
                pricingApproximate: false,
                executionReady: true,
                aspectRatios: [],
                resolutions: Object.keys(pixverse.rates),
                minDurationSeconds: 1,
                maxDurationSeconds: 15,
                audioSupported: true,
                audioMode: "toggle" as const,
                pricingNote:
                  "Live PixVerse duration/resolution/audio pricing is verified.",
              }]
            : []),
        ].map((model) => [model.model, model]),
      ).values(),
    ].sort(
      (a, b) =>
        a.minLevel - b.minLevel ||
        a.displayName.localeCompare(b.displayName),
    ),
    // Backward-compatible PixVerse view for the existing affordability helper.
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
