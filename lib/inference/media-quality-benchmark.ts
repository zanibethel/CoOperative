import "server-only";

import { nousManagedMediaCatalog } from "@/lib/inference/nous-managed-media";

export const MEDIA_QUALITY_BENCHMARK_SUITE = "media_quality_v1";

export type MediaQualityBenchmarkCase = {
  id: string;
  label: string;
  primaryDimensions: Array<
    "visual_quality" | "prompt_adherence" | "anatomy" | "speed"
  >;
  prompt: string;
  evaluation: string[];
};

export const MEDIA_QUALITY_BENCHMARK_CASES: MediaQualityBenchmarkCase[] = [
  {
    id: "composition-adherence",
    label: "Composition + prompt adherence",
    primaryDimensions: ["prompt_adherence", "visual_quality", "speed"],
    prompt:
      "Create a photorealistic editorial studio photograph, vertical 4:5. An adult woman sits centered on a matte red cube. A closed yellow umbrella stands upright on the viewer's left. A cobalt-blue ceramic vase sits on a small white pedestal on the viewer's right and contains exactly three white tulips. She holds a closed green notebook flat across her lap with both hands. Neutral warm-gray seamless backdrop, softbox lighting, realistic skin and fabric texture, no text, no logos, no extra people, no extra flowers.",
    evaluation: [
      "Required objects are present and correctly placed.",
      "Exactly three white tulips are visible.",
      "Notebook, umbrella, cube, vase, and subject attributes follow the prompt.",
      "No unrequested people, text, logos, or obvious object duplication.",
      "Overall photographic coherence and detail remain high.",
    ],
  },
  {
    id: "hands-anatomy",
    label: "Hands + anatomy",
    primaryDimensions: ["anatomy", "visual_quality", "prompt_adherence", "speed"],
    prompt:
      "Create a photorealistic waist-up photograph of an adult baker kneading a round loaf of dough on a wooden workbench in a bright artisan kitchen, vertical 4:5. Both hands must be fully visible from wrist to fingertips, separated enough to inspect clearly, with natural finger count and believable joint structure. Sleeves end above the wrists. No utensils, flour bags, bowls, or other objects may cover either hand. Natural facial features, realistic skin texture, believable shoulders and arms, shallow depth of field, no text, no logos.",
    evaluation: [
      "Both hands are completely visible and inspectable.",
      "Finger count, joints, wrists, arms, shoulders, and body proportions are plausible.",
      "No object obscures either hand.",
      "The requested baker/workbench/kitchen composition is followed.",
      "Skin, fabric, dough, and wood remain visually coherent.",
    ],
  },
  {
    id: "premium-realism",
    label: "Overall visual quality",
    primaryDimensions: ["visual_quality", "prompt_adherence", "speed"],
    prompt:
      "Create a premium photorealistic golden-hour lifestyle portrait, vertical 4:5, of an adult woman standing beside a dark vintage convertible outside an upscale desert-modern home. She wears a cream linen shirt, fitted blue denim, and subtle gold jewelry. Include realistic skin texture, individual hair strands, natural eyes, detailed denim and linen weave, believable reflections in the car paint and windshield, warm rim light, soft cinematic depth of field, physically plausible shadows, no text, no logos, no watermark.",
    evaluation: [
      "Skin, hair, eyes, clothing, reflections, and lighting look photographically convincing.",
      "Fine textures survive without plastic or oversharpened artifacts.",
      "Car geometry, glass reflections, body proportions, and shadows are coherent.",
      "The requested wardrobe, environment, lighting, and framing are followed.",
      "Overall image quality is suitable for premium social/lifestyle use.",
    ],
  },
];

function nextCent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

export async function prepareMediaQualityBenchmark() {
  const catalog = await nousManagedMediaCatalog();
  const modelIds = ["fal-ai/z-image/turbo", "fal-ai/nano-banana-pro"] as const;

  const routes = modelIds.map((model) => {
    const live = catalog.image.find((candidate) => candidate.model === model);
    if (!live) {
      return {
        provider: "nous" as const,
        model,
        available: false,
        estimatedCostPerImageUsd: null,
        safeCapPerImageUsd: null,
        estimatedSuiteCostUsd: null,
        safeSuiteCapUsd: null,
        pricingSource: null,
      };
    }

    const estimatedCostPerImageUsd = live.estimatedCostUsd;
    const safeCapPerImageUsd = nextCent(estimatedCostPerImageUsd);
    const count = MEDIA_QUALITY_BENCHMARK_CASES.length;

    return {
      provider: "nous" as const,
      model,
      available: true,
      estimatedCostPerImageUsd,
      safeCapPerImageUsd,
      estimatedSuiteCostUsd: estimatedCostPerImageUsd * count,
      safeSuiteCapUsd: safeCapPerImageUsd * count,
      pricingSource: live.pricingSource,
    };
  });

  const available = routes.filter((route) => route.available);
  const estimatedTotalCostUsd = available.reduce(
    (total, route) => total + (route.estimatedSuiteCostUsd || 0),
    0,
  );
  const safeTotalCapUsd = available.reduce(
    (total, route) => total + (route.safeSuiteCapUsd || 0),
    0,
  );

  return {
    suite: MEDIA_QUALITY_BENCHMARK_SUITE,
    preparedAt: new Date().toISOString(),
    imageCount: MEDIA_QUALITY_BENCHMARK_CASES.length * modelIds.length,
    callsPerRoute: MEDIA_QUALITY_BENCHMARK_CASES.length,
    cases: MEDIA_QUALITY_BENCHMARK_CASES,
    routes,
    estimatedTotalCostUsd,
    safeTotalCapUsd,
    executionPolicy: {
      paidCallsStartOnPrepare: false,
      exactRouteOnly: true,
      retries: false,
      fallbacks: false,
      parallelRouteSubstitution: false,
      identicalPromptsAcrossRoutes: true,
      contentClass: "sfw",
    },
  };
}
