import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const MODEL_SCORE_VERSION = "2026-10-05.1";

type JsonMap = Record<string, unknown>;

type RegistryRoute = {
  id: string;
  provider: string;
  model: string;
  endpoint: string;
  route_kind: string;
  free: boolean;
  execution_ready: boolean;
  input_modalities: unknown;
  output_modalities: unknown;
  capability_summary: unknown;
  pricing: unknown;
  limits: unknown;
};

type TaskType =
  | "general-text"
  | "summary"
  | "coding"
  | "reasoning"
  | "vision"
  | "image-generation"
  | "image-reference"
  | "video-generation";

type RuntimeAggregate = {
  successes: number;
  failures: number;
  latenciesMs: number[];
};

type QualityAggregate = {
  values: Map<string, number[]>;
};

type PreliminaryScore = {
  route: RegistryRoute;
  taskType: TaskType;
  capabilityFit: number;
  qualityScore: number | null;
  qualitySampleCount: number;
  benchmarkCoverage: number;
  runtimeSampleCount: number;
  reliabilityScore: number | null;
  latencySampleCount: number;
  medianLatencyMs: number | null;
  representativeCostUsd: number | null;
  sourceSummary: JsonMap;
};

function jsonMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function routeKey(provider: string, model: string, endpoint = "") {
  return [provider, model, endpoint || ""].join("|");
}

function runtimeKey(provider: string, model: string, taskType: TaskType) {
  return [provider, model, taskType].join("|");
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function shrinkToNeutral(score: number, confidence: number) {
  const boundedConfidence = Math.max(0, Math.min(1, confidence));
  return clamp(50 + (score - 50) * boundedConfidence);
}

function taskTypesForRoute(route: RegistryRoute): TaskType[] {
  const inputModalities = stringArray(route.input_modalities).map((value) =>
    value.toLowerCase(),
  );
  const capability = jsonMap(route.capability_summary);

  switch (route.route_kind) {
    case "text":
    case "text-runtime":
      return ["general-text", "summary", "coding", "reasoning"];
    case "multimodal-text":
      return [
        "general-text",
        "summary",
        "coding",
        "reasoning",
        ...(inputModalities.includes("image") ? (["vision"] as TaskType[]) : []),
      ];
    case "vision":
      return ["vision"];
    case "image":
      return [
        "image-generation",
        ...(
          capability.referenceImages === true ||
          Number(capability.minInputReferences || 0) > 0 ||
          inputModalities.includes("image")
            ? (["image-reference"] as TaskType[])
            : []
        ),
      ];
    case "image-edit":
      return ["image-reference"];
    case "video":
      return ["video-generation"];
    default:
      return [];
  }
}

function capabilityFit(route: RegistryRoute, taskType: TaskType) {
  const capability = jsonMap(route.capability_summary);
  const limits = jsonMap(route.limits);
  const inputModalities = stringArray(route.input_modalities).map((value) =>
    value.toLowerCase(),
  );
  const contextLength = numeric(limits.contextLength) || 0;

  if (taskType === "general-text" || taskType === "summary") {
    return clamp(
      88 + (contextLength >= 100_000 ? 8 : contextLength >= 32_000 ? 4 : 0),
    );
  }
  if (taskType === "coding") {
    return clamp(
      60 +
        (capability.reasoning === true ? 15 : 0) +
        (capability.structuredOutput === true ? 10 : 0) +
        (capability.toolCalling === true ? 10 : 0) +
        (contextLength >= 100_000 ? 5 : 0),
    );
  }
  if (taskType === "reasoning") {
    return clamp(
      65 +
        (capability.reasoning === true ? 30 : 0) +
        (contextLength >= 100_000 ? 5 : 0),
    );
  }
  if (taskType === "vision") {
    return inputModalities.includes("image") || route.route_kind === "vision"
      ? 100
      : 0;
  }
  if (taskType === "image-generation") {
    return route.route_kind === "image" ? 100 : 0;
  }
  if (taskType === "image-reference") {
    return route.route_kind === "image-edit" ||
      capability.referenceImages === true ||
      Number(capability.minInputReferences || 0) > 0 ||
      inputModalities.includes("image")
      ? 100
      : 0;
  }
  if (taskType === "video-generation") {
    return route.route_kind === "video" ? 100 : 0;
  }
  return 50;
}

function representativeTextCostUsd(pricing: JsonMap, taskType: TaskType) {
  const promptPerToken =
    numeric(pricing.promptTokenUsd) ?? numeric(jsonMap(pricing.raw).prompt);
  const completionPerToken =
    numeric(pricing.completionTokenUsd) ??
    numeric(jsonMap(pricing.raw).completion);
  if (promptPerToken === null || completionPerToken === null) return null;

  const assumptions: Record<
    "general-text" | "summary" | "coding" | "reasoning" | "vision",
    [number, number]
  > = {
    "general-text": [2_000, 1_000],
    summary: [4_000, 800],
    coding: [4_000, 2_000],
    reasoning: [4_000, 2_000],
    vision: [2_000, 1_000],
  };

  const [inputTokens, outputTokens] =
    assumptions[
      taskType as
        | "general-text"
        | "summary"
        | "coding"
        | "reasoning"
        | "vision"
    ] || assumptions["general-text"];

  return inputTokens * promptPerToken + outputTokens * completionPerToken;
}

function representativeMediaCostUsd(pricing: JsonMap, taskType: TaskType) {
  const estimated = numeric(pricing.estimatedCostUsd);
  if (estimated !== null) return estimated;

  const minUnit = numeric(pricing.minUnitCostUsd);
  const maxUnit = numeric(pricing.maxUnitCostUsd);
  if (minUnit !== null || maxUnit !== null) {
    if (minUnit !== null && maxUnit !== null) return (minUnit + maxUnit) / 2;
    return minUnit ?? maxUnit;
  }

  const rates = jsonMap(pricing.rates);
  const perSecondRates: number[] = [];
  for (const value of Object.values(rates)) {
    const row = jsonMap(value);
    for (const candidate of [row.withoutAudio, row.withAudio]) {
      const parsed = numeric(candidate);
      if (parsed !== null && parsed >= 0) perSecondRates.push(parsed);
    }
  }
  if (perSecondRates.length) {
    const avg =
      perSecondRates.reduce((total, value) => total + value, 0) /
      perSecondRates.length;
    return taskType === "video-generation" ? avg * 5 : avg;
  }

  return null;
}

function representativeCostUsd(route: RegistryRoute, taskType: TaskType) {
  if (route.free || route.provider === "cooperative-local") return 0;
  const pricing = jsonMap(route.pricing);
  if (
    taskType === "general-text" ||
    taskType === "summary" ||
    taskType === "coding" ||
    taskType === "reasoning" ||
    taskType === "vision"
  ) {
    return representativeTextCostUsd(pricing, taskType);
  }
  return representativeMediaCostUsd(pricing, taskType);
}

function benchmarkQuality(
  aggregate: QualityAggregate | undefined,
  taskType: TaskType,
) {
  if (!aggregate) {
    return {
      score: null as number | null,
      sampleCount: 0,
      coverage: 0,
      dimensionAverages: {} as Record<string, number>,
    };
  }

  const weights =
    taskType === "image-reference"
      ? {
          visual_quality: 0.25,
          prompt_adherence: 0.2,
          anatomy: 0.15,
          reference_fidelity: 0.25,
          edit_strength: 0.15,
        }
      : taskType === "image-generation"
        ? {
            visual_quality: 0.4,
            prompt_adherence: 0.35,
            anatomy: 0.25,
          }
        : {};

  const dimensionAverages: Record<string, number> = {};
  let weighted = 0;
  let observedWeight = 0;
  let totalWeight = 0;
  let sampleCount = 0;

  for (const [dimension, weight] of Object.entries(weights)) {
    totalWeight += weight;
    const values = aggregate.values.get(dimension) || [];
    if (!values.length) continue;
    const average =
      values.reduce((total, value) => total + value, 0) / values.length;
    dimensionAverages[dimension] = rounded(average);
    weighted += average * weight;
    observedWeight += weight;
    sampleCount += values.length;
  }

  if (observedWeight <= 0 || totalWeight <= 0) {
    return {
      score: null,
      sampleCount: 0,
      coverage: 0,
      dimensionAverages,
    };
  }

  return {
    score: rounded(weighted / observedWeight),
    sampleCount,
    coverage: rounded(observedWeight / totalWeight, 2),
    dimensionAverages,
  };
}

function reliabilityFromRuntime(runtime: RuntimeAggregate | undefined) {
  if (!runtime) {
    return {
      score: null as number | null,
      sampleCount: 0,
      confidence: 0,
    };
  }
  const total = runtime.successes + runtime.failures;
  if (!total) {
    return { score: null, sampleCount: 0, confidence: 0 };
  }

  const score = ((runtime.successes + 2) / (total + 4)) * 100;
  return {
    score: rounded(score),
    sampleCount: total,
    confidence: Math.min(1, total / 20),
  };
}

function normalizedLowerIsBetter(
  value: number | null,
  values: number[],
  options: { best: number; worst: number; logScale?: boolean },
) {
  if (value === null) return null;
  if (value === 0 && options.logScale) return 100;
  const positive = values.filter((item) => item > 0 && Number.isFinite(item));
  if (!positive.length) return options.best;
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  if (Math.abs(max - min) < 1e-12) return (options.best + options.worst) / 2;

  const transform = (item: number) =>
    options.logScale ? Math.log10(Math.max(item, 1e-12)) : item;
  const minT = transform(min);
  const maxT = transform(max);
  const valueT = transform(Math.max(value, 1e-12));
  const normalized = (valueT - minT) / Math.max(1e-12, maxT - minT);
  return clamp(options.best - normalized * (options.best - options.worst));
}

function normalizeTextProvider(value: unknown) {
  const provider = typeof value === "string" ? value.toLowerCase() : "";
  if (provider.includes("openrouter")) return "openrouter";
  if (
    provider.includes("local") ||
    provider.includes("mlx") ||
    provider.includes("unison") ||
    provider.includes("owned")
  ) {
    return "cooperative-local";
  }
  return typeof value === "string" && value ? value : "unknown";
}

function textTaskType(taskClass: unknown): TaskType {
  switch (taskClass) {
    case "summary":
      return "summary";
    case "coding":
    case "debugging":
      return "coding";
    case "reasoning":
    case "planning":
    case "long-context":
    case "media-planning":
      return "reasoning";
    default:
      return "general-text";
  }
}

function addRuntime(
  map: Map<string, RuntimeAggregate>,
  key: string,
  status: string,
  latencyMs: number | null,
) {
  const row = map.get(key) || {
    successes: 0,
    failures: 0,
    latenciesMs: [],
  };
  if (status === "completed") row.successes += 1;
  if (status === "failed") row.failures += 1;
  if (
    status === "completed" &&
    latencyMs !== null &&
    Number.isFinite(latencyMs) &&
    latencyMs >= 0
  ) {
    row.latenciesMs.push(latencyMs);
  }
  map.set(key, row);
}

export async function recomputeAllModelTaskScores() {
  const admin = createAdminSupabaseClient();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const calculatedAt = new Date().toISOString();

  const [
    { data: routes, error: routeError },
    { data: benchmarks, error: benchmarkError },
    { data: mediaJobs, error: mediaError },
    { data: mediaOutcomes, error: outcomeError },
    { data: textJobs, error: textError },
  ] = await Promise.all([
    admin
      .from("ai_model_registry")
      .select(
        "id,provider,model,endpoint,route_kind,free,execution_ready,input_modalities,output_modalities,capability_summary,pricing,limits",
      )
      .eq("status", "active")
      .eq("execution_ready", true),
    admin
      .from("media_model_benchmarks")
      .select("provider,model,endpoint,dimension,score,status")
      .eq("status", "measured"),
    admin
      .from("media_generation_jobs")
      .select(
        "id,status,provider,model,kind,pricing_dimensions,started_at,completed_at,created_at",
      )
      .gte("created_at", cutoff)
      .in("status", ["completed", "failed"]),
    admin
      .from("media_route_outcomes")
      .select("source_job_id,outcome_kind,created_at")
      .gte("created_at", cutoff),
    admin
      .from("text_inference_jobs")
      .select(
        "status,result_model,result_provider,fallback_model,fallback_provider,task_class,latency_ms,created_at",
      )
      .gte("created_at", cutoff)
      .in("status", ["completed", "failed"]),
  ]);

  if (routeError) throw new Error(`Registry score route query failed: ${JSON.stringify(routeError)}`);
  if (benchmarkError) throw new Error(`Registry score benchmark query failed: ${JSON.stringify(benchmarkError)}`);
  if (mediaError) throw new Error(`Registry score media runtime query failed: ${JSON.stringify(mediaError)}`);
  if (outcomeError) throw new Error(`Registry score outcome query failed: ${JSON.stringify(outcomeError)}`);
  if (textError) throw new Error(`Registry score text runtime query failed: ${JSON.stringify(textError)}`);

  const qualityMap = new Map<string, QualityAggregate>();
  for (const row of benchmarks || []) {
    if (row.score === null) continue;
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    const key = routeKey(row.provider, row.model, row.endpoint || "");
    const aggregate =
      qualityMap.get(key) || { values: new Map<string, number[]>() };
    const values = aggregate.values.get(row.dimension) || [];
    values.push(score);
    aggregate.values.set(row.dimension, values);
    qualityMap.set(key, aggregate);
  }

  const excludedMediaJobs = new Set(
    (mediaOutcomes || [])
      .filter((row) =>
        ["provider-policy", "capability-refusal", "executor-policy"].includes(
          row.outcome_kind,
        ),
      )
      .map((row) => row.source_job_id)
      .filter(Boolean),
  );

  const runtimeMap = new Map<string, RuntimeAggregate>();

  for (const row of mediaJobs || []) {
    if (excludedMediaJobs.has(row.id)) continue;
    const pricing = jsonMap(row.pricing_dimensions);
    if (pricing.capabilityTest === true) continue;

    const referenceCount = numeric(pricing.referenceAttachmentCount) || 0;
    const taskType: TaskType =
      row.kind === "video"
        ? "video-generation"
        : referenceCount > 0
          ? "image-reference"
          : "image-generation";
    const endpoint =
      typeof pricing.referenceEditEndpoint === "string"
        ? pricing.referenceEditEndpoint
        : "";
    const latency =
      row.started_at && row.completed_at
        ? Math.max(
            0,
            Date.parse(row.completed_at) - Date.parse(row.started_at),
          )
        : null;

    addRuntime(
      runtimeMap,
      runtimeKey(row.provider, row.model, taskType),
      row.status,
      latency,
    );

    if (endpoint) {
      addRuntime(
        runtimeMap,
        runtimeKey(
          row.provider + "|endpoint:" + endpoint,
          row.model,
          taskType,
        ),
        row.status,
        latency,
      );
    }
  }

  for (const row of textJobs || []) {
    const model =
      (typeof row.fallback_model === "string" && row.fallback_model) ||
      (typeof row.result_model === "string" && row.result_model) ||
      "";
    if (!model) continue;
    const provider = normalizeTextProvider(
      row.fallback_provider || row.result_provider,
    );
    if (provider === "unknown") continue;
    const taskType = textTaskType(row.task_class);
    addRuntime(
      runtimeMap,
      runtimeKey(provider, model, taskType),
      row.status,
      numeric(row.latency_ms),
    );
  }

  const preliminary: PreliminaryScore[] = [];

  for (const route of (routes || []) as RegistryRoute[]) {
    for (const taskType of taskTypesForRoute(route)) {
      const benchmark = benchmarkQuality(
        qualityMap.get(routeKey(route.provider, route.model, route.endpoint)),
        taskType,
      );

      let runtime = runtimeMap.get(
        runtimeKey(route.provider, route.model, taskType),
      );
      if (route.endpoint) {
        runtime =
          runtimeMap.get(
            runtimeKey(
              route.provider + "|endpoint:" + route.endpoint,
              route.model,
              taskType,
            ),
          ) || runtime;
      }

      const reliability = reliabilityFromRuntime(runtime);
      const medianLatencyMs = runtime?.latenciesMs.length
        ? median(runtime.latenciesMs)
        : null;

      preliminary.push({
        route,
        taskType,
        capabilityFit: capabilityFit(route, taskType),
        qualityScore: benchmark.score,
        qualitySampleCount: benchmark.sampleCount,
        benchmarkCoverage: benchmark.coverage,
        runtimeSampleCount: reliability.sampleCount,
        reliabilityScore: reliability.score,
        latencySampleCount: runtime?.latenciesMs.length || 0,
        medianLatencyMs,
        representativeCostUsd: representativeCostUsd(route, taskType),
        sourceSummary: {
          benchmarkDimensions: benchmark.dimensionAverages,
          benchmarkCoverage: benchmark.coverage,
          reliabilityConfidence: reliability.confidence,
          runtimeWindowDays: 90,
        },
      });
    }
  }

  const costsByTask = new Map<TaskType, number[]>();
  const latenciesByTask = new Map<TaskType, number[]>();

  for (const item of preliminary) {
    if (
      item.representativeCostUsd !== null &&
      item.representativeCostUsd > 0
    ) {
      const values = costsByTask.get(item.taskType) || [];
      values.push(item.representativeCostUsd);
      costsByTask.set(item.taskType, values);
    }
    if (item.medianLatencyMs !== null && item.medianLatencyMs > 0) {
      const values = latenciesByTask.get(item.taskType) || [];
      values.push(item.medianLatencyMs);
      latenciesByTask.set(item.taskType, values);
    }
  }

  const scoreRows = preliminary.map((item) => {
    const costKnown = item.representativeCostUsd !== null;
    const costEfficiency =
      item.representativeCostUsd === 0
        ? 100
        : item.representativeCostUsd === null
          ? 50
          : normalizedLowerIsBetter(
              item.representativeCostUsd,
              costsByTask.get(item.taskType) || [],
              { best: 90, worst: 20, logScale: true },
            ) ?? 50;

    const speed =
      item.medianLatencyMs === null
        ? null
        : normalizedLowerIsBetter(
            item.medianLatencyMs,
            latenciesByTask.get(item.taskType) || [],
            { best: 100, worst: 25 },
          );

    const performanceComponents: Array<[number, number]> = [
      [item.capabilityFit, 0.2],
    ];
    if (item.qualityScore !== null) {
      performanceComponents.push([item.qualityScore, 0.45]);
    }
    if (item.reliabilityScore !== null) {
      performanceComponents.push([item.reliabilityScore, 0.2]);
    }
    if (speed !== null) {
      performanceComponents.push([speed, 0.15]);
    }

    const totalWeight = performanceComponents.reduce(
      (total, [, weight]) => total + weight,
      0,
    );
    const rawPerformance =
      performanceComponents.reduce(
        (total, [score, weight]) => total + score * weight,
        0,
      ) / Math.max(0.0001, totalWeight);

    const qualityConfidence =
      item.qualityScore === null
        ? 0
        : Math.min(
            1,
            item.benchmarkCoverage *
              Math.min(1, Math.max(1, item.qualitySampleCount) / 6),
          );
    const reliabilityConfidence = Math.min(
      1,
      item.runtimeSampleCount / 20,
    );
    const speedConfidence = Math.min(1, item.latencySampleCount / 10);
    const performanceConfidence = Math.min(
      1,
      0.15 +
        0.45 * qualityConfidence +
        0.25 * reliabilityConfidence +
        0.15 * speedConfidence,
    );
    const performanceScore = shrinkToNeutral(
      rawPerformance,
      performanceConfidence,
    );

    const rawValue = performanceScore * 0.75 + costEfficiency * 0.25;
    const overallConfidence = Math.min(
      1,
      performanceConfidence * 0.8 + (costKnown ? 0.2 : 0),
    );
    const overallValue = shrinkToNeutral(rawValue, overallConfidence);

    return {
      registry_route_id: item.route.id,
      provider: item.route.provider,
      model: item.route.model,
      endpoint: item.route.endpoint || "",
      route_kind: item.route.route_kind,
      task_type: item.taskType,
      capability_fit_score: rounded(item.capabilityFit),
      quality_score:
        item.qualityScore === null ? null : rounded(item.qualityScore),
      reliability_score:
        item.reliabilityScore === null
          ? null
          : rounded(item.reliabilityScore),
      speed_score: speed === null ? null : rounded(speed),
      performance_score: rounded(performanceScore),
      cost_efficiency_score: rounded(costEfficiency),
      overall_value_score: rounded(overallValue),
      confidence: rounded(overallConfidence, 3),
      quality_sample_count: item.qualitySampleCount,
      runtime_sample_count: item.runtimeSampleCount,
      latency_sample_count: item.latencySampleCount,
      benchmark_coverage: rounded(item.benchmarkCoverage, 3),
      representative_cost_usd:
        item.representativeCostUsd === null
          ? null
          : Number(item.representativeCostUsd.toFixed(8)),
      score_version: MODEL_SCORE_VERSION,
      source_summary: {
        ...item.sourceSummary,
        rawPerformance: rounded(rawPerformance),
        performanceConfidence: rounded(performanceConfidence, 3),
        rawValue: rounded(rawValue),
        costKnown,
        medianLatencyMs:
          item.medianLatencyMs === null
            ? null
            : Math.round(item.medianLatencyMs),
      },
      calculated_at: calculatedAt,
      updated_at: calculatedAt,
    };
  });

  const { error: clearError } = await admin
    .from("ai_model_task_scores")
    .delete()
    .gte("calculated_at", "1970-01-01T00:00:00.000Z");
  if (clearError) throw new Error(`Registry score reset failed: ${JSON.stringify(clearError)}`);

  for (let index = 0; index < scoreRows.length; index += 250) {
    const { error } = await admin
      .from("ai_model_task_scores")
      .insert(scoreRows.slice(index, index + 250));
    if (error) throw new Error(`Registry score insert failed at ${index}: ${JSON.stringify(error)}`);
  }

  const { error: summaryError } = await admin.rpc(
    "refresh_ai_model_registry_score_summaries",
    {
      p_score_version: MODEL_SCORE_VERSION,
    },
  );
  if (summaryError) throw new Error(`Registry score summary refresh failed: ${JSON.stringify(summaryError)}`);

  const byTask = new Map<string, number>();
  for (const row of scoreRows) {
    byTask.set(row.task_type, (byTask.get(row.task_type) || 0) + 1);
  }

  return {
    scoreVersion: MODEL_SCORE_VERSION,
    routeCount: (routes || []).length,
    taskScoreCount: scoreRows.length,
    byTask: Object.fromEntries([...byTask.entries()].sort()),
    calculatedAt,
  };
}

export async function modelTaskScores(input?: {
  provider?: string;
  model?: string;
  taskType?: string;
  minConfidence?: number;
  limit?: number;
}) {
  const admin = createAdminSupabaseClient();
  let query = admin
    .from("ai_model_task_scores")
    .select(
      "registry_route_id,provider,model,endpoint,route_kind,task_type,capability_fit_score,quality_score,reliability_score,speed_score,performance_score,cost_efficiency_score,overall_value_score,confidence,quality_sample_count,runtime_sample_count,latency_sample_count,benchmark_coverage,representative_cost_usd,score_version,source_summary,calculated_at",
    )
    .order("overall_value_score", { ascending: false })
    .order("confidence", { ascending: false });

  if (input?.provider) query = query.eq("provider", input.provider);
  if (input?.model) query = query.eq("model", input.model);
  if (input?.taskType) query = query.eq("task_type", input.taskType);
  if (typeof input?.minConfidence === "number") {
    query = query.gte("confidence", input.minConfidence);
  }
  query = query.limit(Math.min(1000, Math.max(1, input?.limit ?? 200)));

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
