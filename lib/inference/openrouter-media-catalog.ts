import "server-only";

export type MediaCatalogKind = "image" | "video";

export type MediaCatalogModel = {
  id: string;
  name: string;
  kind: MediaCatalogKind;
  free: boolean;
  unit: "image" | "second" | "megapixel" | "unknown";
  minUnitCostUsd: number | null;
  maxUnitCostUsd: number | null;
  costLabel: string;
  inputModalities: string[];
  aspectRatios: string[];
  durations: number[];
  resolutions: string[];
  audioSupported: boolean;
  pricingSkus: Record<string, number>;
};

export type MediaCatalog = {
  fetchedAt: string;
  source: "openrouter-live";
  image: MediaCatalogModel[];
  video: MediaCatalogModel[];
};

const API = "https://openrouter.ai/api/v1";
const ROOT = "https://openrouter.ai";
const CACHE_MS = 15 * 60 * 1000;

let cached: { at: number; value: MediaCatalog } | null = null;
let inflight: Promise<MediaCatalog> | null = null;

const RECOMMENDED_IMAGE_IDS = new Set([
  "inclusionai/ming-image-0.1-design",
  "recraft/recraft-v4.1-flash",
  "bytedance-seed/seedream-5-0-flash",
  "bytedance-seed/seedream-5-0-lite",
  "qwen/qwen-image-3",
  "qwen/qwen-image-3-pro",
  "google/gemini-3.1-flash-lite-image",
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
  "x-ai/grok-imagine-image-quality",
  "openai/gpt-image-2",
  "openai/gpt-image-2.5-flare",
  "openai/gpt-image-2.5-sunburst",
]);

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function enumValues(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const values = (value as { values?: unknown }).values;
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
}

function costLabel(min: number | null, max: number | null, unit: MediaCatalogModel["unit"]) {
  if (min === 0 && max === 0) return "Free";
  if (min === null) return "Live price on request";
  const suffix =
    unit === "second" ? "/sec" :
    unit === "image" ? "/image" :
    unit === "megapixel" ? "/MP" : "";
  if (max !== null && Math.abs(max - min) > 0.000001) {
    return `$${min.toFixed(min < 0.01 ? 4 : 3)}–$${max.toFixed(max < 0.01 ? 4 : 3)}${suffix}`;
  }
  return `$${min.toFixed(min < 0.01 ? 4 : 3)}${suffix}`;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter catalog returned ${response.status} for ${url}.`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function normalizedVideoPricing(pricing: unknown) {
  const skus: Record<string, number> = {};
  if (!pricing || typeof pricing !== "object") return skus;

  for (const [rawKey, raw] of Object.entries(pricing as Record<string, unknown>)) {
    const amount = numberValue(raw);
    if (amount === null) continue;
    const key = rawKey.toLowerCase().replace(/-/g, "_");
    if (
      key.startsWith("duration_seconds") ||
      key.startsWith("per_video_second") ||
      key.startsWith("cents_per_second_output") ||
      key.startsWith("cents_per_video_output_second")
    ) {
      skus[key] = key.startsWith("cents_") ? amount / 100 : amount;
    }
  }
  return skus;
}

function videoPricing(pricing: unknown) {
  const skus = normalizedVideoPricing(pricing);
  const values = Object.values(skus);
  if (!values.length) {
    return { min: null, max: null, unit: "unknown" as const, skus };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    unit: "second" as const,
    skus,
  };
}

async function imageEndpointPricing(path: string | null) {
  if (!path) return { min: null, max: null, unit: "unknown" as const };
  try {
    const payload = await fetchJson(path.startsWith("http") ? path : ROOT + path);
    const endpoints =
      payload && typeof payload === "object" && Array.isArray((payload as { endpoints?: unknown }).endpoints)
        ? ((payload as { endpoints: unknown[] }).endpoints)
        : [];
    const rows = endpoints.flatMap((endpoint) => {
      if (!endpoint || typeof endpoint !== "object") return [];
      const pricing = (endpoint as { pricing?: unknown }).pricing;
      return Array.isArray(pricing) ? pricing : [];
    });
    const imageCosts: number[] = [];
    const megapixelCosts: number[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const unit = String((row as { unit?: unknown }).unit || "");
      const billable = String((row as { billable?: unknown }).billable || "");
      const cost = numberValue((row as { cost_usd?: unknown }).cost_usd);
      if (cost === null) continue;
      if (cost <= 0) continue;
      if (unit === "image" || billable === "output_image") imageCosts.push(cost);
      else if (unit.includes("megapixel")) megapixelCosts.push(cost);
    }
    const values = imageCosts.length ? imageCosts : megapixelCosts;
    if (!values.length) return { min: null, max: null, unit: "unknown" as const };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      unit: imageCosts.length ? ("image" as const) : ("megapixel" as const),
    };
  } catch {
    return { min: null, max: null, unit: "unknown" as const };
  }
}

async function buildCatalog(): Promise<MediaCatalog> {
  const [imagePayload, videoPayload] = await Promise.all([
    fetchJson(`${API}/images/models`),
    fetchJson(`${API}/videos/models`),
  ]);

  const rawImages =
    imagePayload && typeof imagePayload === "object" && Array.isArray((imagePayload as { data?: unknown }).data)
      ? ((imagePayload as { data: unknown[] }).data)
      : [];
  const rawVideos =
    videoPayload && typeof videoPayload === "object" && Array.isArray((videoPayload as { data?: unknown }).data)
      ? ((videoPayload as { data: unknown[] }).data)
      : [];

  const imageCandidates = rawImages.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const id = String((entry as { id?: unknown }).id || "");
    return RECOMMENDED_IMAGE_IDS.has(id) || id.endsWith(":free");
  });

  const imageRows = await Promise.all(
    imageCandidates.map(async (entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "");
      const supported = row.supported_parameters && typeof row.supported_parameters === "object"
        ? (row.supported_parameters as Record<string, unknown>)
        : {};
      const architecture = row.architecture && typeof row.architecture === "object"
        ? (row.architecture as Record<string, unknown>)
        : {};
      const pricing = await imageEndpointPricing(typeof row.endpoints === "string" ? row.endpoints : null);
      // OpenRouter currently requires funded credit for Image API requests even
      // when an endpoint reports zero-looking catalog pricing. Do not classify
      // image generation as free from a zero price field alone.
      const free = id.endsWith(":free");
      return {
        id,
        name: String(row.name || id),
        kind: "image" as const,
        free,
        unit: pricing.unit,
        minUnitCostUsd: pricing.min,
        maxUnitCostUsd: pricing.max,
        costLabel: costLabel(pricing.min, pricing.max, pricing.unit),
        inputModalities: Array.isArray(architecture.input_modalities)
          ? architecture.input_modalities.filter((item): item is string => typeof item === "string")
          : [],
        aspectRatios: enumValues(supported.aspect_ratio),
        durations: [],
        resolutions: enumValues(supported.resolution),
        audioSupported: false,
        pricingSkus: {},
      };
    }),
  );

  const videoRows: MediaCatalogModel[] = rawVideos.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = String(row.id || "");
    if (!id) return [];
    const pricing = videoPricing(row.pricing_skus);
    const durations = Array.isArray(row.supported_durations)
      ? row.supported_durations.map(numberValue).filter((value): value is number => value !== null)
      : [];
    if (!durations.length) return [];
    const free = id.endsWith(":free") || (pricing.min === 0 && pricing.max === 0);
    return [{
      id,
      name: String(row.name || id),
      kind: "video" as const,
      free,
      unit: pricing.unit,
      minUnitCostUsd: pricing.min,
      maxUnitCostUsd: pricing.max,
      costLabel: costLabel(pricing.min, pricing.max, pricing.unit),
      inputModalities: row.supported_frame_images ? ["text", "image"] : ["text"],
      aspectRatios: Array.isArray(row.supported_aspect_ratios)
        ? row.supported_aspect_ratios.filter((item): item is string => typeof item === "string")
        : [],
      durations,
      resolutions: Array.isArray(row.supported_resolutions)
        ? row.supported_resolutions.filter((item): item is string => typeof item === "string")
        : [],
      audioSupported: row.generate_audio === true,
      pricingSkus: pricing.skus,
    }];
  });

  const sortModels = (a: MediaCatalogModel, b: MediaCatalogModel) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    const aCost = a.minUnitCostUsd ?? Number.POSITIVE_INFINITY;
    const bCost = b.minUnitCostUsd ?? Number.POSITIVE_INFINITY;
    return aCost - bCost || a.name.localeCompare(b.name);
  };

  return {
    fetchedAt: new Date().toISOString(),
    source: "openrouter-live",
    image: imageRows.sort(sortModels),
    video: videoRows.sort(sortModels),
  };
}

export async function openRouterMediaCatalog(force = false) {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) return cached.value;
  if (!force && inflight) return inflight;

  inflight = buildCatalog()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

export function mediaLevelBands(models: MediaCatalogModel[]) {
  const paid = models
    .map((model) => model.minUnitCostUsd)
    .filter((value): value is number => value !== null && value > 0);

  return {
    0: { label: "Free", ceilingUsd: 0 },
    1: { label: "Low", ceilingUsd: percentile(paid, 0.25) },
    2: { label: "Balanced", ceilingUsd: percentile(paid, 0.5) },
    3: { label: "High", ceilingUsd: percentile(paid, 0.75) },
    4: { label: "Premium", ceilingUsd: paid.length ? Math.max(...paid) : null },
  } as const;
}

export function recommendedForLevel(models: MediaCatalogModel[], level: 0 | 1 | 2 | 3 | 4) {
  const free = models.filter((model) => model.free);
  if (level === 0) return free[0] || null;

  const bands = mediaLevelBands(models);
  const floor =
    level <= 1 ? 0 :
    bands[(level - 1) as 1 | 2 | 3].ceilingUsd ?? 0;
  const ceiling = bands[level].ceilingUsd;

  const candidates = models.filter((model) => {
    const cost = model.minUnitCostUsd;
    return cost !== null && cost > floor && (ceiling === null || cost <= ceiling);
  });
  return candidates[0] || free[0] || models.find((model) => model.minUnitCostUsd !== null) || null;
}


export function recommendedForRequest(
  models: MediaCatalogModel[],
  level: 0 | 1 | 2 | 3 | 4,
  request: {
    durationSeconds?: number | null;
    aspectRatio?: string | null;
    resolution?: string | null;
    audio?: boolean | null;
  } = {},
) {
  const capable = models.filter((model) => {
    const durationOk =
      !request.durationSeconds ||
      model.durations.length === 0 ||
      model.durations.includes(request.durationSeconds);
    const aspectOk =
      !request.aspectRatio ||
      model.aspectRatios.length === 0 ||
      model.aspectRatios.includes(request.aspectRatio);
    const resolutionOk =
      !request.resolution ||
      model.resolutions.length === 0 ||
      model.resolutions.some((value) => value.toLowerCase() === request.resolution?.toLowerCase());
    const audioOk = request.audio !== true || model.audioSupported;
    return durationOk && aspectOk && resolutionOk && audioOk;
  });

  return recommendedForLevel(capable.length ? capable : models, level);
}

function skuResolution(key: string) {
  const match = key.match(/(?:^|_)(360p|480p|540p|720p|768p|1080p|1440p|2160p|4k)(?:_|$)/i);
  return match?.[1]?.toLowerCase() || null;
}

function skuAudio(key: string) {
  if (key.includes("without_audio") || key.includes("no_audio")) return false;
  if (key.includes("with_audio")) return true;
  return null;
}

export function bestOpenRouterVideoPricing(
  model: MediaCatalogModel,
  request: { resolution?: string | null; audio?: boolean | null } = {},
) {
  const entries = Object.entries(model.pricingSkus);
  if (!entries.length) {
    return model.minUnitCostUsd === null
      ? null
      : { rateUsdPerSecond: model.minUnitCostUsd, resolution: request.resolution || null, audio: request.audio ?? null };
  }

  const candidates = entries.flatMap(([key, rate]) => {
    const resolution = skuResolution(key);
    const audio = skuAudio(key);
    if (
      request.resolution &&
      resolution &&
      resolution.toLowerCase() !== request.resolution.toLowerCase()
    ) return [];
    if (request.audio !== null && request.audio !== undefined && audio !== null && audio !== request.audio) return [];
    let score = 0;
    if (request.resolution && resolution?.toLowerCase() === request.resolution.toLowerCase()) score += 4;
    if (request.audio !== null && request.audio !== undefined && audio === request.audio) score += 3;
    if (resolution) score += 1;
    if (audio !== null) score += 1;
    return [{ key, rate, resolution, audio, score }];
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.rate - b.rate);
  const bestScore = candidates[0].score;
  const best = candidates.filter((candidate) => candidate.score === bestScore).sort((a, b) => a.rate - b.rate)[0];
  return {
    rateUsdPerSecond: best.rate,
    resolution: request.resolution || best.resolution,
    audio: request.audio ?? best.audio,
  };
}

export function estimateOpenRouterMediaCostUsd(
  model: MediaCatalogModel,
  request: {
    durationSeconds?: number | null;
    resolution?: string | null;
    audio?: boolean | null;
    megapixels?: number | null;
  } = {},
) {
  if (model.free) return 0;
  if (model.kind === "video") {
    if (!request.durationSeconds) return null;
    const pricing = bestOpenRouterVideoPricing(model, request);
    return pricing ? pricing.rateUsdPerSecond * request.durationSeconds : null;
  }
  if (model.minUnitCostUsd === null) return null;
  if (model.unit === "image") return model.minUnitCostUsd;
  if (model.unit === "megapixel") {
    return model.minUnitCostUsd * Math.max(1, request.megapixels || 1);
  }
  return null;
}
