import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type MediaBenchmarkDimension =
  | "visual_quality"
  | "prompt_adherence"
  | "anatomy"
  | "reference_fidelity"
  | "edit_strength"
  | "speed";

export type MediaBenchmarkEvidence = {
  provider: string;
  model: string;
  endpoint: string;
  dimension: MediaBenchmarkDimension;
  score: number | null;
  status: "measured" | "inconclusive";
  measurement: Record<string, unknown>;
  sourceType:
    | "controlled_benchmark"
    | "manual_review"
    | "runtime_observation"
    | "provider_metadata";
  sourceJobId: string | null;
  notes: string | null;
  measuredAt: string;
};

export type MediaBenchmarkDimensionScores = {
  visualQuality: number | null;
  promptAdherence: number | null;
  anatomy: number | null;
  referenceFidelity: number | null;
  editStrength: number | null;
  speed: number | null;
};

export type MediaBenchmarkRouteSummary = {
  dimensions: MediaBenchmarkDimensionScores;
  measuredDimensions: number;
  latestMeasuredAt: string | null;
};

function dimensionKey(
  dimension: MediaBenchmarkDimension,
): keyof MediaBenchmarkDimensionScores {
  switch (dimension) {
    case "visual_quality":
      return "visualQuality";
    case "prompt_adherence":
      return "promptAdherence";
    case "anatomy":
      return "anatomy";
    case "reference_fidelity":
      return "referenceFidelity";
    case "edit_strength":
      return "editStrength";
    case "speed":
      return "speed";
  }
}

export async function mediaBenchmarkEvidenceForOwner(
  ownerRef: string,
): Promise<MediaBenchmarkEvidence[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_model_benchmarks")
    .select(
      "provider,model,endpoint,dimension,score,status,measurement,source_type,source_job_id,notes,measured_at",
    )
    .eq("owner_ref", ownerRef)
    .order("measured_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  const latest = new Map<string, MediaBenchmarkEvidence>();
  for (const row of data || []) {
    if (
      row.dimension !== "visual_quality" &&
      row.dimension !== "prompt_adherence" &&
      row.dimension !== "anatomy" &&
      row.dimension !== "reference_fidelity" &&
      row.dimension !== "edit_strength" &&
      row.dimension !== "speed"
    ) {
      continue;
    }

    const key = [
      row.provider,
      row.model,
      row.endpoint || "",
      row.dimension,
    ].join("|");
    if (latest.has(key)) continue;

    const sourceType =
      row.source_type === "manual_review" ||
      row.source_type === "runtime_observation" ||
      row.source_type === "provider_metadata"
        ? row.source_type
        : "controlled_benchmark";

    latest.set(key, {
      provider: row.provider,
      model: row.model,
      endpoint: row.endpoint || "",
      dimension: row.dimension,
      score:
        row.status === "measured" && row.score !== null
          ? Number(row.score)
          : null,
      status: row.status === "inconclusive" ? "inconclusive" : "measured",
      measurement:
        row.measurement && typeof row.measurement === "object"
          ? (row.measurement as Record<string, unknown>)
          : {},
      sourceType,
      sourceJobId: row.source_job_id || null,
      notes: row.notes || null,
      measuredAt: row.measured_at,
    });
  }

  return [...latest.values()];
}

export function mediaBenchmarkSummaryForRoute(
  evidence: MediaBenchmarkEvidence[] | undefined,
  input: {
    provider: string;
    model: string;
    endpoint?: string | null;
  },
): MediaBenchmarkRouteSummary {
  const endpoint = input.endpoint || "";
  const dimensions: MediaBenchmarkDimensionScores = {
    visualQuality: null,
    promptAdherence: null,
    anatomy: null,
    referenceFidelity: null,
    editStrength: null,
    speed: null,
  };

  let measuredDimensions = 0;
  let latestMeasuredAt: string | null = null;

  for (const item of evidence || []) {
    if (
      item.provider !== input.provider ||
      item.model !== input.model ||
      item.endpoint !== endpoint
    ) {
      continue;
    }

    const key = dimensionKey(item.dimension);
    dimensions[key] = item.status === "measured" ? item.score : null;
    if (item.status === "measured" && item.score !== null) {
      measuredDimensions += 1;
    }
    if (
      !latestMeasuredAt ||
      Date.parse(item.measuredAt) > Date.parse(latestMeasuredAt)
    ) {
      latestMeasuredAt = item.measuredAt;
    }
  }

  return {
    dimensions,
    measuredDimensions,
    latestMeasuredAt,
  };
}

export function mediaBenchmarkQualityComposite(input: {
  summary: MediaBenchmarkRouteSummary;
  heuristicScore: number;
  referenceWorkflow: boolean;
}) {
  const weights = input.referenceWorkflow
    ? {
        visualQuality: 0.25,
        promptAdherence: 0.2,
        anatomy: 0.15,
        referenceFidelity: 0.25,
        editStrength: 0.15,
      }
    : {
        visualQuality: 0.4,
        promptAdherence: 0.35,
        anatomy: 0.25,
        referenceFidelity: 0,
        editStrength: 0,
      };

  let observedWeighted = 0;
  let observedWeight = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights) as Array<
    [keyof typeof weights, number]
  >) {
    totalWeight += weight;
    const score = input.summary.dimensions[key];
    if (score === null) continue;
    observedWeighted += score * weight;
    observedWeight += weight;
  }

  if (observedWeight <= 0 || totalWeight <= 0) {
    return {
      qualityScore: Math.max(0, Math.min(100, input.heuristicScore)),
      benchmarkCoverage: 0,
      qualitySource: "heuristic" as const,
    };
  }

  const observedScore = observedWeighted / observedWeight;
  const coverage = Math.max(0, Math.min(1, observedWeight / totalWeight));
  const qualityScore =
    observedScore * coverage + input.heuristicScore * (1 - coverage);

  return {
    qualityScore: Math.round(Math.max(0, Math.min(100, qualityScore))),
    benchmarkCoverage: Number(coverage.toFixed(2)),
    qualitySource:
      coverage >= 0.999 ? ("benchmark" as const) : ("mixed" as const),
  };
}
