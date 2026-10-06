import "server-only";

export const HERMES_MEDIA_RELEASE =
  process.env.HERMES_MEDIA_RELEASE?.trim() || "v2026.9.24";

const HERMES_REPO_RAW =
  `https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_MEDIA_RELEASE}`;

const IMAGE_CATALOG_URL =
  `${HERMES_REPO_RAW}/tools/image_generation_catalog.py`;
const VIDEO_CATALOG_URL =
  `${HERMES_REPO_RAW}/plugins/video_gen/fal/__init__.py`;

const CACHE_MS = 15 * 60 * 1000;

export type HermesManagedImageModel = {
  id: string;
  displayName: string;
  speed: string | null;
  strengths: string | null;
  priceLabel: string | null;
  estimatedCostUsd: number | null;
  pricingUnit: "image" | "megapixel" | "unknown";
  qualityLevel: 1 | 2 | 3 | 4;
  editEndpoint: string | null;
  maxReferenceImages: number;
};

export type HermesManagedVideoModel = {
  id: string;
  displayName: string;
  speed: string | null;
  tier: "cheap" | "premium" | "unknown";
  strengths: string | null;
  textEndpoint: string | null;
  imageEndpoint: string | null;
  aspectRatios: string[];
  resolutions: string[];
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  audioSupported: boolean;
};

export type HermesManagedMediaCatalog = {
  release: string;
  fetchedAt: string;
  source: string;
  imageSource: string;
  videoSource: string;
  image: HermesManagedImageModel[];
  video: HermesManagedVideoModel[];
};

let cached:
  | { at: number; value: HermesManagedMediaCatalog }
  | null = null;

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Hermes catalog returned HTTP ${response.status} for ${url}.`,
      );
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function pythonCallBlocks(
  source: string,
  marker: "_model" | "_family",
) {
  const regex = new RegExp(
    `^\\s{4}"([^"]+)": ${marker}\\(`,
    "gm",
  );
  const matches = [...source.matchAll(regex)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index ?? source.length
        : source.length;
    return {
      id: match[1],
      block: source.slice(start, end),
    };
  });
}

function quotedStrings(value: string) {
  return [...value.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(
    (match) => match[1],
  );
}

function tupleStrings(block: string, key: string) {
  const match = block.match(
    new RegExp(`${key}=\\(([^)]*)\\)`, "m"),
  );
  if (!match) return [];
  return quotedStrings(match[1]);
}

function pricingInfo(label: string | null) {
  if (!label) {
    return {
      estimatedCostUsd: null,
      pricingUnit: "unknown" as const,
    };
  }

  const amounts = [...label.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (!amounts.length) {
    return {
      estimatedCostUsd: null,
      pricingUnit: "unknown" as const,
    };
  }

  const pricingUnit = /(?:\/\s*mp\b|megapixel)/i.test(label)
    ? ("megapixel" as const)
    : /image/i.test(label) || amounts.length > 0
      ? ("image" as const)
      : ("unknown" as const);

  // Conservative for ranges / multiple listed modes. This is only a routing
  // estimate. Final execution stays subject to provider/runtime spend gates.
  return {
    estimatedCostUsd: Math.max(...amounts),
    pricingUnit,
  };
}

function qualityLevel(cost: number | null): 1 | 2 | 3 | 4 {
  if (cost === null) return 2;
  if (cost <= 0.01) return 1;
  if (cost <= 0.05) return 2;
  if (cost <= 0.1) return 3;
  return 4;
}

function parseImageCatalog(source: string): HermesManagedImageModel[] {
  const rows = pythonCallBlocks(source, "_model").map(({ id, block }) => {
    const callStart = block.indexOf("_model(");
    const strings = quotedStrings(
      callStart >= 0 ? block.slice(callStart + "_model(".length) : block,
    );

    const displayName = strings[0] || id;
    const speed = strings[1] || null;
    const strengths = strings[2] || null;
    const priceLabel =
      strings
        .slice(3, 10)
        .find((value) =>
          /\$|price|pricing|cost|tier/i.test(value),
        ) || strings[3] || null;
    const pricing = pricingInfo(priceLabel);
    const editEndpoint =
      block.match(/edit_endpoint\s*=\s*"([^"]+)"/)?.[1] || null;
    const maxReferenceImages = Number(
      block.match(/max_reference_images\s*=\s*([0-9]+)/)?.[1] || 0,
    );

    return {
      id,
      displayName,
      speed,
      strengths,
      priceLabel,
      estimatedCostUsd: pricing.estimatedCostUsd,
      pricingUnit: pricing.pricingUnit,
      qualityLevel: qualityLevel(pricing.estimatedCostUsd),
      editEndpoint,
      maxReferenceImages:
        Number.isFinite(maxReferenceImages) && maxReferenceImages > 0
          ? maxReferenceImages
          : 0,
    };
  });

  // Hermes defines these two rows through a Python dict-comprehension rather
  // than literal top-level keys, so include them when that source construct is present.
  if (
    source.includes('openai/gpt-image-2.5/{variant}/text-to-image')
  ) {
    for (const variant of ["flare", "sunburst"] as const) {
      const id = `openai/gpt-image-2.5/${variant}/text-to-image`;
      if (rows.some((row) => row.id === id)) continue;
      rows.push({
        id,
        displayName: `GPT Image 2.5 ${variant[0].toUpperCase()}${variant.slice(1)}`,
        speed: variant === "flare" ? "Fast" : "Slower",
        strengths:
          variant === "flare"
            ? "Everyday creation, natural lighting and textures"
            : "Precision editing, subject and composition consistency",
        priceLabel: "Token-based pricing",
        estimatedCostUsd: null,
        pricingUnit: "unknown",
        qualityLevel: variant === "flare" ? 3 : 4,
        editEndpoint: `openai/gpt-image-2.5/${variant}/edit`,
        maxReferenceImages: 16,
      });
    }
  }

  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function parseVideoCatalog(source: string): HermesManagedVideoModel[] {
  return pythonCallBlocks(source, "_family")
    .map(({ id, block }) => {
      const callStart = block.indexOf("_family(");
      const strings = quotedStrings(
        callStart >= 0 ? block.slice(callStart + "_family(".length) : block,
      );
      const displayName = strings[0] || id;
      const speed = strings[1] || null;
      const tier =
        strings[2] === "cheap" || strings[2] === "premium"
          ? strings[2]
          : "unknown";
      const strengths = strings[3] || null;

      const endpointStrings = strings.filter(
        (value) =>
          /(?:text-to-video|image-to-video)/i.test(value) ||
          /^fal-ai\/veo3\.1$/i.test(value),
      );
      const textEndpoint =
        endpointStrings.find((value) =>
          /text-to-video/i.test(value),
        ) ||
        endpointStrings.find((value) => /^fal-ai\/veo3\.1$/i.test(value)) ||
        null;
      const imageEndpoint =
        endpointStrings.find((value) =>
          /image-to-video/i.test(value),
        ) || null;

      const durationMatch = block.match(
        /durations=\(\s*([0-9]+)\s*,\s*([0-9]+)\s*\)/,
      );
      const minDurationSeconds = durationMatch
        ? Number(durationMatch[1])
        : null;
      const maxDurationSeconds = durationMatch
        ? Number(durationMatch[2])
        : null;

      return {
        id,
        displayName,
        speed,
        tier,
        strengths,
        textEndpoint,
        imageEndpoint,
        aspectRatios: tupleStrings(block, "aspect_ratios"),
        resolutions: tupleStrings(block, "resolutions"),
        minDurationSeconds:
          minDurationSeconds !== null && Number.isFinite(minDurationSeconds)
            ? minDurationSeconds
            : null,
        maxDurationSeconds:
          maxDurationSeconds !== null && Number.isFinite(maxDurationSeconds)
            ? maxDurationSeconds
            : null,
        audioSupported:
          /\baudio\s*=\s*True\b/.test(block) ||
          /\baudio_native\s*=\s*True\b/.test(block),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function hermesManagedMediaCatalog(): Promise<HermesManagedMediaCatalog> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const [imageSourceText, videoSourceText] = await Promise.all([
    fetchText(IMAGE_CATALOG_URL),
    fetchText(VIDEO_CATALOG_URL),
  ]);

  const value: HermesManagedMediaCatalog = {
    release: HERMES_MEDIA_RELEASE,
    fetchedAt: new Date().toISOString(),
    source: `hermes-managed-catalog@${HERMES_MEDIA_RELEASE}`,
    imageSource: IMAGE_CATALOG_URL,
    videoSource: VIDEO_CATALOG_URL,
    image: parseImageCatalog(imageSourceText),
    video: parseVideoCatalog(videoSourceText),
  };

  if (!value.image.length && !value.video.length) {
    throw new Error(
      `Hermes ${HERMES_MEDIA_RELEASE} media catalog parsed zero models.`,
    );
  }

  cached = { at: Date.now(), value };
  return value;
}
