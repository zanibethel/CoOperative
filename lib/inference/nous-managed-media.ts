export type NousManagedMediaKind = "image" | "video";

export type NousManagedMediaChoice = {
  provider: "nous";
  model: string;
  estimatedCostUsd: number;
  qualityLabel: string;
  degradedFromRequestedLevel: boolean;
  executionNote: string;
};

type ImageCandidate = {
  minLevel: 1 | 2 | 3 | 4;
  model: string;
  conservativeCostUsd: number;
  qualityLabel: string;
};

const IMAGE_CANDIDATES: ImageCandidate[] = [
  {
    minLevel: 1,
    model: "fal-ai/z-image/turbo",
    conservativeCostUsd: 0.01,
    qualityLabel: "economy",
  },
  {
    minLevel: 2,
    model: "fal-ai/qwen-image",
    conservativeCostUsd: 0.03,
    qualityLabel: "balanced",
  },
  {
    minLevel: 3,
    model: "fal-ai/gpt-image-1.5",
    conservativeCostUsd: 0.034,
    qualityLabel: "high",
  },
  {
    minLevel: 4,
    model: "fal-ai/nano-banana-pro",
    conservativeCostUsd: 0.15,
    qualityLabel: "premium",
  },
];

const PIXVERSE_360P_NO_AUDIO_USD_PER_SECOND = 0.025;

export function chooseNousManagedImage(
  requestedLevel: 0 | 1 | 2 | 3 | 4,
  maxSpendUsd: number | null,
): NousManagedMediaChoice | null {
  if (requestedLevel === 0) return null;

  const cap =
    maxSpendUsd === null ? Number.POSITIVE_INFINITY : Math.max(0, maxSpendUsd);
  const requestedCandidates = IMAGE_CANDIDATES.filter(
    (candidate) => candidate.minLevel <= requestedLevel,
  );
  const affordable = requestedCandidates.filter(
    (candidate) => candidate.conservativeCostUsd <= cap,
  );
  const selected = affordable.at(-1);
  if (!selected) return null;

  return {
    provider: "nous",
    model: selected.model,
    estimatedCostUsd: selected.conservativeCostUsd,
    qualityLabel: selected.qualityLabel,
    degradedFromRequestedLevel: selected.minLevel < requestedLevel,
    executionNote:
      "Nous Portal managed image generation is preferred because it uses the connected subscription credit balance before BYOK fallback.",
  };
}

export function chooseNousManagedVideo(
  requestedLevel: 0 | 1 | 2 | 3 | 4,
  maxSpendUsd: number | null,
  durationSeconds: number | null,
): NousManagedMediaChoice | null {
  if (requestedLevel === 0 || !durationSeconds) return null;

  const estimatedCostUsd =
    durationSeconds * PIXVERSE_360P_NO_AUDIO_USD_PER_SECOND;
  const cap =
    maxSpendUsd === null ? Number.POSITIVE_INFINITY : Math.max(0, maxSpendUsd);
  if (estimatedCostUsd > cap) return null;

  return {
    provider: "nous",
    model: "pixverse-v6",
    estimatedCostUsd,
    qualityLabel: "test / economy video",
    degradedFromRequestedLevel: requestedLevel > 1,
    executionNote:
      "Nous Portal managed PixVerse is configured for the low-cost test path; the prompt should request 360p with audio disabled.",
  };
}

export function affordableVideoSuggestion(
  durationSeconds: number | null,
  maxSpendUsd: number | null,
) {
  if (!durationSeconds || maxSpendUsd === null) return null;
  const requestedCost = durationSeconds * PIXVERSE_360P_NO_AUDIO_USD_PER_SECOND;
  if (requestedCost <= maxSpendUsd) return null;

  const affordableSeconds = Math.floor(
    maxSpendUsd / PIXVERSE_360P_NO_AUDIO_USD_PER_SECOND,
  );
  const minimumRequestedBudget = requestedCost;

  return {
    affordableSeconds: Math.max(0, affordableSeconds),
    minimumRequestedBudget,
    rateUsdPerSecond: PIXVERSE_360P_NO_AUDIO_USD_PER_SECOND,
  };
}
