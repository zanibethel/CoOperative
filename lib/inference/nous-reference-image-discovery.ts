import "server-only";

export const HERMES_REFERENCE_CATALOG_RELEASE = "v2026.9.24";
export const HERMES_REFERENCE_CATALOG_SOURCE =
  "https://github.com/NousResearch/hermes-agent/blob/v2026.9.24/tools/image_generation_catalog.py";

export type ReferenceCapabilityClass =
  | "precision-edit"
  | "identity-reference"
  | "semantic-multi-reference"
  | "multi-reference-edit"
  | "fast-reference-edit";

export type ReferencePricing = {
  status: "verified-live" | "unavailable";
  estimatedCostUsd: number | null;
  unit: "per-image" | "baseline-edit" | "token-estimate" | "unknown";
  basis: string;
  source: string;
  checkedAt: string;
};

export type NousReferenceImageModel = {
  provider: "nous";
  model: string;
  editEndpoint: string;
  displayName: string;
  capabilityClass: ReferenceCapabilityClass;
  capabilitySummary: string;
  hermesRelease: string;
  hermesCatalogVerified: true;
  hermesMaxReferenceImages: number;
  capabilitySource: string;
  pricing: ReferencePricing;
  managedGatewayAvailability: "not-probed";
};

type Candidate = Omit<
  NousReferenceImageModel,
  "provider" | "hermesRelease" | "hermesCatalogVerified" | "capabilitySource" | "pricing" | "managedGatewayAvailability"
> & {
  pricingSource: string;
  parsePricing: (text: string) => Omit<ReferencePricing, "status" | "source" | "checkedAt"> | null;
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
      headers: {
        Accept: "text/html, text/plain;q=0.9",
        "User-Agent": "CoOperative/1.0 reference-image-discovery",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Reference-image discovery returned HTTP ${response.status} for ${url}.`);
    }
    const text = await response.text();
    textCache.set(url, { at: Date.now(), text });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function numberFrom(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function perImagePricing(text: string, basis: string) {
  const value = numberFrom(text, [
    /request will cost\s+\$([0-9.]+)\s+per image/i,
    /cost per image\s*\|?\s*\$([0-9.]+)/i,
    /\$([0-9.]+)\s*\/\s*image/i,
  ]);
  if (value === null) return null;
  return {
    estimatedCostUsd: value,
    unit: "per-image" as const,
    basis,
  };
}

function gpt25MediumSquarePricing(text: string) {
  const tableRow = text.match(
    /1024\s*[×x]\s*1024[^$]*\$[0-9.]+[^$]*\$([0-9.]+)/i,
  );
  if (!tableRow) return null;
  const value = Number(tableRow[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    estimatedCostUsd: value,
    unit: "token-estimate" as const,
    basis:
      "Hermes pins GPT Image 2.5 to medium quality. Estimate uses fal's current 1024×1024 medium edit row including one input image; prompt complexity can change actual token cost.",
  };
}

function flux2ProPricing(text: string) {
  const firstOutputMp = numberFrom(text, [
    /cost\s+\$([0-9.]+)\s+for the first megapixel of output/i,
  ]);
  const extraMp = numberFrom(text, [
    /plus\s+\$([0-9.]+)\s+per extra megapixel of input and output/i,
  ]);
  if (firstOutputMp === null || extraMp === null) return null;

  return {
    // Baseline comparison: one 1 MP reference + one 1 MP output.
    estimatedCostUsd: firstOutputMp + extraMp,
    unit: "baseline-edit" as const,
    basis:
      "Baseline assumes one 1 MP reference image and one 1 MP output. fal bills the first output MP plus each additional input/output MP.",
  };
}

function flux2KleinPricing(text: string) {
  const rate = numberFrom(text, [
    /requests cost\s+\$([0-9.]+)\s+per megapixel of input and output/i,
  ]);
  if (rate === null) return null;
  return {
    estimatedCostUsd: rate * 2,
    unit: "baseline-edit" as const,
    basis:
      "Baseline assumes one 1 MP reference image plus one 1 MP output at fal's current per-MP input/output rate.",
  };
}

function qwen2ProPricing(text: string) {
  const value = numberFrom(text, [
    /image editing cost\s+\$[0-9.]+\s+per image on the standard tier or\s+\$([0-9.]+)\s+on Pro/i,
    /Editing \(Pro\)[^$]*\$([0-9.]+)\/image/i,
    /Pro[^$]{0,80}\$([0-9.]+)\s*(?:per image|\/image)/i,
  ]);
  if (value === null) return null;
  return {
    estimatedCostUsd: value,
    unit: "per-image" as const,
    basis: "Current fal Qwen Image 2 Pro image-editing price.",
  };
}

const CANDIDATES: Candidate[] = [
  {
    model: "openai/gpt-image-2.5/sunburst/text-to-image",
    editEndpoint: "openai/gpt-image-2.5/sunburst/edit",
    displayName: "GPT Image 2.5 Sunburst Edit",
    capabilityClass: "precision-edit",
    capabilitySummary:
      "Precision-focused editing with subject and composition consistency across iterative revisions.",
    hermesMaxReferenceImages: 16,
    pricingSource: "https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit",
    parsePricing: gpt25MediumSquarePricing,
  },
  {
    model: "openai/gpt-image-2.5/flare/text-to-image",
    editEndpoint: "openai/gpt-image-2.5/flare/edit",
    displayName: "GPT Image 2.5 Flare Edit",
    capabilityClass: "identity-reference",
    capabilitySummary:
      "Fast precise editing designed to keep referenced subjects recognizable while changing only requested details.",
    hermesMaxReferenceImages: 16,
    pricingSource: "https://fal.ai/models/openai/gpt-image-2.5/flare/edit",
    parsePricing: gpt25MediumSquarePricing,
  },
  {
    model: "fal-ai/nano-banana-pro",
    editEndpoint: "fal-ai/nano-banana-pro/edit",
    displayName: "Nano Banana Pro Edit",
    capabilityClass: "semantic-multi-reference",
    capabilitySummary:
      "Premium multimodal editing with semantic reference understanding and strong character/scene consistency.",
    // CoOperative must honor the pinned Hermes runtime limit even if fal currently accepts more.
    hermesMaxReferenceImages: 2,
    pricingSource: "https://fal.ai/models/fal-ai/nano-banana-pro/edit",
    parsePricing: (text) =>
      perImagePricing(
        text,
        "1K edit price. Higher resolution and optional web search can increase cost.",
      ),
  },
  {
    model: "fal-ai/nano-banana-2",
    editEndpoint: "fal-ai/nano-banana-2/edit",
    displayName: "Nano Banana 2 Edit",
    capabilityClass: "semantic-multi-reference",
    capabilitySummary:
      "Fast multimodal image editing with semantic context preservation and multi-reference compositing.",
    hermesMaxReferenceImages: 14,
    pricingSource: "https://fal.ai/models/fal-ai/nano-banana-2/edit",
    parsePricing: (text) =>
      perImagePricing(
        text,
        "1K edit price. Higher resolutions, web grounding, or high thinking can increase cost.",
      ),
  },
  {
    model: "fal-ai/flux-2-pro",
    editEndpoint: "fal-ai/flux-2-pro/edit",
    displayName: "FLUX 2 Pro Edit",
    capabilityClass: "multi-reference-edit",
    capabilitySummary:
      "Production-grade multi-reference editing for photorealistic composition and context-aware transformations.",
    hermesMaxReferenceImages: 9,
    pricingSource: "https://fal.ai/models/fal-ai/flux-2-pro/edit",
    parsePricing: flux2ProPricing,
  },
  {
    model: "fal-ai/qwen-image",
    editEndpoint: "fal-ai/qwen-image-2/pro/edit",
    displayName: "Qwen Image 2 Pro Edit",
    capabilityClass: "multi-reference-edit",
    capabilitySummary:
      "High-fidelity unified editing with strong detail, typography, compositing, and instruction following.",
    hermesMaxReferenceImages: 3,
    pricingSource: "https://fal.ai/qwen-image-2.0",
    parsePricing: qwen2ProPricing,
  },
  {
    model: "fal-ai/flux-2/klein/9b",
    editEndpoint: "fal-ai/flux-2/klein/9b/edit",
    displayName: "FLUX 2 Klein 9B Edit",
    capabilityClass: "fast-reference-edit",
    capabilitySummary:
      "Fast reference-aware image editing for lower-cost iterative work.",
    hermesMaxReferenceImages: 9,
    pricingSource: "https://fal.ai/models/fal-ai/flux-2/klein/9b/edit",
    parsePricing: flux2KleinPricing,
  },
];

async function discoverCandidate(candidate: Candidate): Promise<NousReferenceImageModel> {
  const checkedAt = new Date().toISOString();
  let pricing: ReferencePricing;

  try {
    const text = await liveText(candidate.pricingSource);
    const parsed = candidate.parsePricing(text);
    pricing = parsed
      ? {
          status: "verified-live",
          ...parsed,
          source: candidate.pricingSource,
          checkedAt,
        }
      : {
          status: "unavailable",
          estimatedCostUsd: null,
          unit: "unknown",
          basis:
            "The live provider page was reachable, but CoOperative could not safely parse a current request estimate.",
          source: candidate.pricingSource,
          checkedAt,
        };
  } catch {
    pricing = {
      status: "unavailable",
      estimatedCostUsd: null,
      unit: "unknown",
      basis:
        "The live provider pricing page was unavailable. CoOperative will not substitute a stale price.",
      source: candidate.pricingSource,
      checkedAt,
    };
  }

  return {
    provider: "nous",
    model: candidate.model,
    editEndpoint: candidate.editEndpoint,
    displayName: candidate.displayName,
    capabilityClass: candidate.capabilityClass,
    capabilitySummary: candidate.capabilitySummary,
    hermesRelease: HERMES_REFERENCE_CATALOG_RELEASE,
    hermesCatalogVerified: true,
    hermesMaxReferenceImages: candidate.hermesMaxReferenceImages,
    capabilitySource: HERMES_REFERENCE_CATALOG_SOURCE,
    pricing,
    // Public fal capability/pricing does not prove that the Nous Subscription
    // gateway currently allowlists a specific endpoint. Step 1 deliberately
    // does not submit a generation merely to probe that billing/allowlist gate.
    managedGatewayAvailability: "not-probed",
  };
}

export async function discoverNousReferenceImageModels() {
  const models = await Promise.all(CANDIDATES.map(discoverCandidate));
  return {
    source: "hermes-nous-reference-discovery" as const,
    fetchedAt: new Date().toISOString(),
    hermesRelease: HERMES_REFERENCE_CATALOG_RELEASE,
    hermesCatalogSource: HERMES_REFERENCE_CATALOG_SOURCE,
    executionChanged: false,
    gatewayProbePerformed: false,
    models,
  };
}
