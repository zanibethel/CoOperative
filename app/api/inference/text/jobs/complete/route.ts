import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";
import { z } from "zod";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import { persistResponseSupport } from "@/lib/ai/response-support";
import { refreshRuntimeContextAfterOutcome } from "@/lib/ai/runtime-context-markdown";
import { recordModelCapabilityEvidence } from "@/lib/inference/model-capability-registry";
import { planMediaRepair } from "@/lib/inference/media-repair-planner";
import {
  decidePairwiseVerification,
  pairwiseVerificationSchema,
  type PairwiseVerificationReport,
} from "@/lib/inference/media-pairwise-verifier";
import {
  boundedRepairPrompt,
  boundedRepairSeed,
  boundedRepairStrength,
  candidateRepairPlan,
  executableRepairTargets,
} from "@/lib/inference/media-repair-executor";

export const runtime = "nodejs";
export const maxDuration = 30;

type CompletionBody = {
  jobId?: unknown;
  workerId?: unknown;
  text?: unknown;
  model?: unknown;
  provider?: unknown;
  promptTokens?: unknown;
  outputTokens?: unknown;
  latencyMs?: unknown;
  webSearchUsed?: unknown;
  webAccessMode?: unknown;
  error?: unknown;
};

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const semanticScoreSchema = z.number().min(0).max(100);
const semanticNullableScoreSchema = semanticScoreSchema.nullable();

const semanticFindingSchema = z.object({
  category: z.enum([
    "face",
    "hands",
    "anatomy",
    "skin",
    "lighting",
    "background",
    "prompt",
    "artifact",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().min(1).max(500),
  regionHint: z.string().max(200).nullable().optional().default(null),
  action: z.enum([
    "none",
    "refine-face",
    "refine-hands",
    "refine-anatomy",
    "refine-skin",
    "refine-lighting",
    "inpaint",
    "regenerate",
    "upscale",
  ]),
});

const semanticJudgeSchema = z.object({
  version: z
    .enum(["semantic-vision-v1", "semantic-vision-v1.1"])
    .default("semantic-vision-v1.1"),
  overallScore: semanticScoreSchema,
  promptAdherence: semanticScoreSchema,
  faceQuality: semanticNullableScoreSchema.default(null),
  handQuality: semanticNullableScoreSchema.default(null),
  anatomyQuality: semanticNullableScoreSchema.default(null),
  skinRealism: semanticNullableScoreSchema.default(null),
  lightingConsistency: semanticScoreSchema,
  backgroundIntegrity: semanticScoreSchema,
  artifactSeverity: semanticScoreSchema,
  confidence: z.number().min(0).max(1),
  findings: z.array(semanticFindingSchema).max(16).default([]),
  suggestedActions: z.array(z.string().min(1).max(180)).max(10).default([]),
});

type SemanticJudgeReport = z.infer<typeof semanticJudgeSchema>;

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Semantic vision judge did not return a JSON object.");
  }
  return unfenced.slice(start, end + 1);
}

function parseSemanticJudgeReport(text: string): SemanticJudgeReport {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;

  const versionAliases: Record<string, SemanticJudgeReport["version"]> = {
    "semantic-vision-v1": "semantic-vision-v1",
    "semantic-vision-v1.1": "semantic-vision-v1.1",
    "semantic-vision-v1-1": "semantic-vision-v1.1",
    "semantic-v1.1": "semantic-vision-v1.1",
  };
  if (typeof parsed.version === "string" && versionAliases[parsed.version]) {
    parsed.version = versionAliases[parsed.version];
  }

  if (
    typeof parsed.confidence === "number" &&
    parsed.confidence > 1 &&
    parsed.confidence <= 100
  ) {
    parsed.confidence = parsed.confidence / 100;
  }

  const semanticScoreKeys = [
    "overallScore",
    "promptAdherence",
    "faceQuality",
    "handQuality",
    "anatomyQuality",
    "skinRealism",
    "lightingConsistency",
    "backgroundIntegrity",
    "artifactSeverity",
  ] as const;

  const fractionalSemanticScoreCount = semanticScoreKeys.filter((key) => {
    const value = parsed[key];
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 1
    );
  }).length;

  if (fractionalSemanticScoreCount >= 4) {
    for (const key of semanticScoreKeys) {
      const value = parsed[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      ) {
        parsed[key] = value * 100;
      }
    }
  }

  const categoryAliases: Record<string, string> = {
    face: "face",
    faceQuality: "face",
    hands: "hands",
    hand: "hands",
    handQuality: "hands",
    anatomy: "anatomy",
    anatomyQuality: "anatomy",
    skin: "skin",
    skinRealism: "skin",
    lighting: "lighting",
    lightingConsistency: "lighting",
    background: "background",
    backgroundIntegrity: "background",
    prompt: "prompt",
    promptAdherence: "prompt",
    artifact: "artifact",
    artifactSeverity: "artifact",
  };

  const derivedAction: Record<string, string> = {
    face: "refine-face",
    hands: "refine-hands",
    anatomy: "refine-anatomy",
    skin: "refine-skin",
    lighting: "refine-lighting",
    background: "inpaint",
    prompt: "regenerate",
    artifact: "inpaint",
  };

  const allowedActions = new Set([
    "none",
    "refine-face",
    "refine-hands",
    "refine-anatomy",
    "refine-skin",
    "refine-lighting",
    "inpaint",
    "regenerate",
    "upscale",
  ]);

  if (Array.isArray(parsed.findings)) {
    parsed.findings = parsed.findings
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return value;
        }

        const finding = { ...(value as Record<string, unknown>) };
        if (typeof finding.category === "string") {
          finding.category =
            categoryAliases[finding.category] || finding.category;
        }

        const category =
          typeof finding.category === "string" ? finding.category : "";
        const severity =
          typeof finding.severity === "string" ? finding.severity : "";
        const action =
          typeof finding.action === "string" ? finding.action.trim() : "";

        if (!allowedActions.has(action)) {
          finding.action =
            severity === "low"
              ? "none"
              : derivedAction[category] || "none";
        }

        if (
          typeof finding.description === "string" &&
          /^(?:short factual finding|grounded visible finding)$/i.test(
            finding.description.trim(),
          )
        ) {
          throw new Error(
            "Semantic vision judge returned a placeholder finding description.",
          );
        }

        return finding;
      })
      .slice(0, 16);
  }

  if (Array.isArray(parsed.suggestedActions)) {
    parsed.suggestedActions = parsed.suggestedActions
      .map((value) => {
        if (typeof value === "string") return value.trim();
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { action?: unknown }).action === "string"
        ) {
          return (value as { action: string }).action.trim();
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 10);
  }

  return semanticJudgeSchema.parse(parsed);
}


function parsePairwiseVerificationReport(
  text: string,
): PairwiseVerificationReport {
  const parsed = JSON.parse(extractJsonObject(text));
  return pairwiseVerificationSchema.parse(parsed);
}

function pairwiseVerifierMessages(input: {
  sourcePrompt: string;
  targetCategories: string[];
}) {
  const sourcePrompt = input.sourcePrompt.replace(/\s+/g, " ").trim().slice(0, 6000);
  const targets = input.targetCategories.length
    ? input.targetCategories.join(", ")
    : "the intended repair target";

  return [
    {
      role: "system",
      content:
        "You are CoOperative Pairwise Image Verifier v1. You will receive exactly two images in order: image 1 is the ORIGINAL baseline and image 2 is the REPAIRED CANDIDATE. Compare them directly. Do not assign absolute quality scores. Do not assume the candidate is better. Judge only visible differences. Return exactly one JSON object and no markdown.",
    },
    {
      role: "user",
      content: [
        "Original source prompt:",
        sourcePrompt,
        "",
        `Targeted repair categories: ${targets}.`,
        "",
        "Compare image 2 against image 1. Prefer the candidate only when a targeted dimension clearly improves without material regression elsewhere.",
        "Return these keys only: version, targetResults, promptAdherenceComparison, compositionPreservation, regressions, confidence, summary.",
        'Set version to "semantic-pairwise-v1".',
        "targetResults MUST be a JSON array with exactly one entry for each requested repair category and no extra categories.",
        "Each targetResults entry must contain category, result, confidence, and explanation.",
        "Allowed result values: better, same, worse, uncertain.",
        "promptAdherenceComparison must be better, same, worse, or uncertain.",
        "compositionPreservation must be preserved, changed-minor, changed-material, or uncertain.",
        "regressions MUST be a JSON array. Each regression must contain category, severity, and description.",
        "Allowed regression categories: face, hands, anatomy, skin, lighting, background, prompt, artifact.",
        "Allowed regression severities: low, medium, high, critical.",
        "confidence fields must be between 0 and 1.",
        "If the difference is not visibly clear, use uncertain rather than guessing.",
        "regressions must contain only changes where image 2 is visibly worse than image 1.",
      ].join("\n"),
    },
  ];
}

async function enqueuePairwiseVerifier(
  supabase: AdminClient,
  input: {
    ownerRef: string;
    workerId: string | null;
    originalImageJobId: string;
    candidateImageJobId: string;
    sourcePrompt: string;
    targetCategories: string[];
  },
) {
  if (!input.workerId || !input.targetCategories.length) return null;

  const { data: node, error: nodeError } = await supabase
    .from("unison_nodes")
    .select("capabilities")
    .eq("id", input.workerId)
    .maybeSingle();
  if (nodeError) throw nodeError;

  const capabilities = Array.isArray(node?.capabilities)
    ? node.capabilities.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (!capabilities.includes("semantic_media_pairwise_v1")) {
    return null;
  }

  const { data: existing, error: existingError } = await supabase
    .from("text_inference_jobs")
    .select("id,status")
    .eq("source_image_job_id", input.originalImageJobId)
    .eq("comparison_image_job_id", input.candidateImageJobId)
    .eq("routing_mode", "semantic-pairwise-v1")
    .in("status", ["queued", "running", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing.id;

  const pairwiseJobId = crypto.randomUUID();
  const { error } = await supabase.from("text_inference_jobs").insert({
    id: pairwiseJobId,
    status: "queued",
    client_owner_ref: input.ownerRef,
    messages: pairwiseVerifierMessages({
      sourcePrompt: input.sourcePrompt,
      targetCategories: input.targetCategories,
    }),
    profile: "quality",
    max_tokens: 1100,
    temperature: 0,
    routing_mode: "semantic-pairwise-v1",
    task_class: "media-pairwise-verification",
    route_reason:
      "Compare the original image with its repaired candidate locally before promotion.",
    allow_paid_fallback: false,
    human_approval_required: false,
    capability: "media-judge",
    routing_preference: "require-node",
    preferred_node_id: input.workerId,
    target_node_id: input.workerId,
    source_image_job_id: input.originalImageJobId,
    comparison_image_job_id: input.candidateImageJobId,
  });

  if (error) throw error;
  return pairwiseJobId;
}

async function updateSourceSemanticJudgeTrace(
  supabase: AdminClient,
  sourceImageJobId: string | null,
  semanticJudge: Record<string, unknown>,
) {
  if (!sourceImageJobId) return;

  const { data: sourceJob, error: sourceError } = await supabase
    .from("inference_jobs")
    .select("pipeline_trace")
    .eq("id", sourceImageJobId)
    .maybeSingle();

  if (sourceError) throw sourceError;
  if (!sourceJob) return;

  const existingTrace =
    sourceJob.pipeline_trace &&
    typeof sourceJob.pipeline_trace === "object" &&
    !Array.isArray(sourceJob.pipeline_trace)
      ? (sourceJob.pipeline_trace as Record<string, unknown>)
      : {};

  const { error: updateError } = await supabase
    .from("inference_jobs")
    .update({
      pipeline_trace: {
        ...existingTrace,
        semanticJudge,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", sourceImageJobId);

  if (updateError) throw updateError;
}

async function persistPairwiseVerification(
  supabase: AdminClient,
  input: {
    originalImageJobId: string;
    candidateImageJobId: string;
    verifierJobId: string;
    model: string;
    provider: string;
    latencyMs: number | null;
    report: PairwiseVerificationReport;
    expectedTargetCategories: string[];
  },
) {
  const decision = decidePairwiseVerification(
    input.report,
    input.expectedTargetCategories,
  );

  const { data: original, error: originalError } = await supabase
    .from("inference_jobs")
    .select("id,result_path,result_model,result_provider,pipeline_trace")
    .eq("id", input.originalImageJobId)
    .maybeSingle();
  if (originalError) throw originalError;

  const { data: candidate, error: candidateError } = await supabase
    .from("inference_jobs")
    .select("id,result_path,result_model,result_provider,pipeline_trace")
    .eq("id", input.candidateImageJobId)
    .maybeSingle();
  if (candidateError) throw candidateError;

  if (!original?.result_path || !candidate?.result_path) {
    throw new Error("Pairwise verification requires two completed image results.");
  }

  const verification = {
    status: "completed",
    version: input.report.version,
    verifierJobId: input.verifierJobId,
    model: input.model,
    provider: input.provider,
    latencyMs: input.latencyMs,
    originalImageJobId: input.originalImageJobId,
    candidateImageJobId: input.candidateImageJobId,
    baselineResultPath: original.result_path,
    candidateResultPath: candidate.result_path,
    report: input.report,
    decision,
  };

  const candidateTrace =
    candidate.pipeline_trace &&
    typeof candidate.pipeline_trace === "object" &&
    !Array.isArray(candidate.pipeline_trace)
      ? (candidate.pipeline_trace as Record<string, unknown>)
      : {};

  const { error: candidateUpdateError } = await supabase
    .from("inference_jobs")
    .update({
      parent_image_job_id: input.originalImageJobId,
      pipeline_role: "repair-candidate",
      verification_summary: verification,
      pipeline_trace: {
        ...candidateTrace,
        pairwiseVerification: verification,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.candidateImageJobId);
  if (candidateUpdateError) throw candidateUpdateError;

  const originalTrace =
    original.pipeline_trace &&
    typeof original.pipeline_trace === "object" &&
    !Array.isArray(original.pipeline_trace)
      ? (original.pipeline_trace as Record<string, unknown>)
      : {};

  const originalUpdate: Record<string, unknown> = {
    verification_summary: verification,
    pipeline_trace: {
      ...originalTrace,
      repairVerification: verification,
      finalSelection: {
        selectedImageJobId: decision.acceptCandidate
          ? input.candidateImageJobId
          : input.originalImageJobId,
        reason: decision.verdict,
      },
    },
    updated_at: new Date().toISOString(),
  };

  if (decision.acceptCandidate) {
    originalUpdate.result_path = candidate.result_path;
    originalUpdate.result_model = candidate.result_model;
    originalUpdate.result_provider = candidate.result_provider;
    originalUpdate.accepted_result_job_id = input.candidateImageJobId;
  }

  const { error: originalUpdateError } = await supabase
    .from("inference_jobs")
    .update(originalUpdate)
    .eq("id", input.originalImageJobId);
  if (originalUpdateError) throw originalUpdateError;

  return decision;
}

async function persistPairwiseFailure(
  supabase: AdminClient,
  input: {
    originalImageJobId: string | null;
    candidateImageJobId: string | null;
    verifierJobId: string;
    error: string;
  },
) {
  const failure = {
    status: "failed",
    version: "semantic-pairwise-v1",
    verifierJobId: input.verifierJobId,
    error: input.error.slice(0, 800),
  };

  for (const [jobId, traceKey] of [
    [input.originalImageJobId, "repairVerification"],
    [input.candidateImageJobId, "pairwiseVerification"],
  ] as const) {
    if (!jobId) continue;

    const { data: imageJob, error: imageError } = await supabase
      .from("inference_jobs")
      .select("pipeline_trace")
      .eq("id", jobId)
      .maybeSingle();

    if (imageError || !imageJob) continue;

    const trace =
      imageJob.pipeline_trace &&
      typeof imageJob.pipeline_trace === "object" &&
      !Array.isArray(imageJob.pipeline_trace)
        ? (imageJob.pipeline_trace as Record<string, unknown>)
        : {};

    await supabase
      .from("inference_jobs")
      .update({
        pipeline_trace: {
          ...trace,
          [traceKey]: failure,
        },
        verification_summary: failure,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}


function repairTargetsFromPlan(plan: unknown) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return [];
  const targets = (plan as { targets?: unknown }).targets;
  if (!Array.isArray(targets)) return [];

  return [
    ...new Set(
      targets
        .map((target) => {
          if (!target || typeof target !== "object" || Array.isArray(target)) {
            return null;
          }
          const category = (target as { category?: unknown }).category;
          return typeof category === "string" ? category : null;
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, 8);
}


async function enqueueAutomaticRepairCandidate(
  supabase: AdminClient,
  input: {
    sourceImageJobId: string;
    ownerRef: string;
    semanticJudgeJobId: string;
    repairPlan: ReturnType<typeof planMediaRepair>;
  },
) {
  const targets = executableRepairTargets(input.repairPlan);
  if (!targets.length) return null;

  const { data: source, error: sourceError } = await supabase
    .from("inference_jobs")
    .select(
      "id,client_owner_ref,result_path,prompt,aspect_ratio,content_mode,negative_prompt,seed,pipeline_role,accepted_result_job_id,pipeline_trace",
    )
    .eq("id", input.sourceImageJobId)
    .maybeSingle();

  if (sourceError) throw sourceError;
  if (!source?.result_path) return null;
  if (source.pipeline_role !== "primary") return null;
  if (source.accepted_result_job_id) return null;

  const contentMode =
    typeof source.content_mode === "string" ? source.content_mode : "sfw";
  if (contentMode === "adult_explicit") {
    return null;
  }

  const { data: existing, error: existingError } = await supabase
    .from("inference_jobs")
    .select("id,status")
    .eq("parent_image_job_id", input.sourceImageJobId)
    .eq("pipeline_role", "repair-candidate")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing.id;

  const repairAttempt = 1;
  const candidateJobId = crypto.randomUUID();
  const candidatePlan = candidateRepairPlan(input.repairPlan, targets);
  const sourceSeed =
    typeof source.seed === "number" ? source.seed : Number(source.seed);

  const { error: insertError } = await supabase.from("inference_jobs").insert({
    id: candidateJobId,
    kind: "image",
    status: "queued",
    client_owner_ref:
      typeof source.client_owner_ref === "string"
        ? source.client_owner_ref
        : input.ownerRef,
    prompt: boundedRepairPrompt(
      typeof source.prompt === "string" ? source.prompt : "",
      targets,
    ),
    aspect_ratio:
      typeof source.aspect_ratio === "string" ? source.aspect_ratio : "4:5",
    profile: "quality",
    content_mode: contentMode,
    negative_prompt:
      typeof source.negative_prompt === "string" ? source.negative_prompt : null,
    reference_paths: [
      {
        path: source.result_path,
        title: "Automatic bounded repair source",
      },
    ],
    strength: boundedRepairStrength(targets),
    variation_mode: "preserve",
    seed: boundedRepairSeed(
      Number.isFinite(sourceSeed) ? sourceSeed : null,
      repairAttempt,
    ),
    pipeline_mode: "single-pass",
    required_capabilities: ["image_to_image"],
    parent_image_job_id: input.sourceImageJobId,
    pipeline_role: "repair-candidate",
    repair_plan: candidatePlan,
    repair_attempt: repairAttempt,
    pipeline_trace: {
      version: "repair-candidate-v1",
      sourceImageJobId: input.sourceImageJobId,
      semanticJudgeJobId: input.semanticJudgeJobId,
      executor: "bounded-img2img-v1",
      targets: targets.map((target) => ({
        category: target.category,
        plannedAction: target.plannedAction,
        priority: target.priority,
      })),
    },
  });

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate } = await supabase
        .from("inference_jobs")
        .select("id")
        .eq("parent_image_job_id", input.sourceImageJobId)
        .eq("pipeline_role", "repair-candidate")
        .eq("repair_attempt", repairAttempt)
        .maybeSingle();
      return duplicate?.id || null;
    }
    throw insertError;
  }

  const sourceTrace =
    source.pipeline_trace &&
    typeof source.pipeline_trace === "object" &&
    !Array.isArray(source.pipeline_trace)
      ? (source.pipeline_trace as Record<string, unknown>)
      : {};

  await supabase
    .from("inference_jobs")
    .update({
      pipeline_trace: {
        ...sourceTrace,
        repairCandidate: {
          status: "queued",
          version: "bounded-img2img-v1",
          candidateJobId,
          repairAttempt,
          targetCategories: targets.map((target) => target.category),
          promotionRequiresPairwiseVerification: true,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sourceImageJobId);

  return candidateJobId;
}

async function recordSemanticJudgeEvidence(input: {
  ownerRef: string;
  judgeJobId: string;
  sourceImageJobId: string;
  model: string;
  provider: string;
  latencyMs: number | null;
  report: SemanticJudgeReport;
}) {
  await recordModelCapabilityEvidence({
    ownerRef: input.ownerRef,
    provider: "cooperative-local",
    model: "local-image-quality",
    endpoint: "",
    routeKind: "image",
    capabilityKey: "semantic-quality-judge",
    scope: input.report.version,
    state: "supported",
    sourceType: "runtime-success",
    sourceRef: input.judgeJobId,
    confidence: Math.max(0.5, Math.min(0.99, input.report.confidence)),
    evidence: {
      sourceImageJobId: input.sourceImageJobId,
      judgeModel: input.model,
      judgeProvider: input.provider,
      latencyMs: input.latencyMs,
      report: input.report,
    },
  });
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

async function recordUnisonTextUsage(
  supabase: AdminClient,
  input: {
    jobId: string;
    workerId: string | null;
    claimedAt: string | null;
    status: "completed" | "failed";
    completedAt: string;
    latencyMs: number | null;
  },
) {
  if (!input.workerId) return;

  try {
    const { data: node, error: nodeError } = await supabase
      .from("unison_nodes")
      .select("contributor_user_id,resources")
      .eq("id", input.workerId)
      .maybeSingle();

    if (nodeError || !node?.contributor_user_id) return;

    const claimedMs = input.claimedAt ? Date.parse(input.claimedAt) : NaN;
    const completedMs = Date.parse(input.completedAt);
    const elapsedSeconds =
      Number.isFinite(claimedMs) && Number.isFinite(completedMs)
        ? Math.max(0, Math.ceil((completedMs - claimedMs) / 1000))
        : 0;
    const computeSeconds =
      input.latencyMs !== null
        ? Math.max(0, Math.ceil(input.latencyMs / 1000))
        : elapsedSeconds;

    const resources = (node.resources || {}) as { gpus?: Array<unknown> };
    const gpuSeconds = resources.gpus?.length ? computeSeconds : 0;

    const { error } = await supabase.from("unison_usage_ledger").upsert(
      {
        contributor_user_id: node.contributor_user_id,
        node_id: input.workerId,
        source_job_type: "text_generation",
        source_job_id: input.jobId,
        status: input.status,
        compute_seconds: computeSeconds,
        gpu_seconds: gpuSeconds,
        cpu_seconds: gpuSeconds ? 0 : computeSeconds,
        earned_cents: 0,
        estimated_external_cost_cents: 0,
        started_at: input.claimedAt,
        completed_at: input.completedAt,
      },
      { onConflict: "source_job_type,source_job_id" },
    );

    if (error) {
      console.error("Could not record Unison text contribution", {
        jobId: input.jobId,
        workerId: input.workerId,
        detail: error.message.slice(0, 500),
      });
    }
  } catch (error) {
    console.error("Could not record Unison text contribution", {
      jobId: input.jobId,
      workerId: input.workerId,
      detail: error instanceof Error ? error.message.slice(0, 500) : "Unknown ledger error",
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompletionBody;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : null;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error: jobError } = await supabase
      .from("text_inference_jobs")
      .select("id,status,client_owner_ref,conversation_id,worker_id,claimed_at,personal_use,personal_user_id,personal_conversation_id,messages,capability,routing_mode,routing_preference,route_reason,business_id,source_image_job_id,comparison_image_job_id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (workerId && job.worker_id && job.worker_id !== workerId) {
      return NextResponse.json(
        { error: "This job is leased to a different node." },
        { status: 409 },
      );
    }
    if (job.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (typeof body.error === "string" && body.error.trim()) {
      const completedAt = new Date().toISOString();
      const failureUpdate: Record<string, unknown> = {
        status: "failed",
        error: body.error.slice(0, 1200),
        completed_at: completedAt,
        updated_at: completedAt,
      };
      if (job.personal_use) {
        failureUpdate.messages = [
          { role: "system", content: "Personal AI payload removed after local execution." },
        ];
        failureUpdate.partial_text = null;
        failureUpdate.result_text = null;
      }

      const { error: updateError } = await supabase
        .from("text_inference_jobs")
        .update(failureUpdate)
        .eq("id", jobId);

      if (updateError) throw updateError;

      if (job.capability === "media-judge") {
        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt,
          latencyMs: null,
        });

        if (job.routing_mode === "semantic-pairwise-v1") {
          await persistPairwiseFailure(supabase, {
            originalImageJobId:
              typeof job.source_image_job_id === "string"
                ? job.source_image_job_id
                : null,
            candidateImageJobId:
              typeof job.comparison_image_job_id === "string"
                ? job.comparison_image_job_id
                : null,
            verifierJobId: jobId,
            error: body.error,
          }).catch((traceError) => {
            console.error("Could not persist pairwise verifier failure", {
              verifierJobId: jobId,
              detail:
                traceError instanceof Error
                  ? traceError.message.slice(0, 500)
                  : "unknown",
            });
          });
        } else {
          await updateSourceSemanticJudgeTrace(
            supabase,
            typeof job.source_image_job_id === "string"
              ? job.source_image_job_id
              : null,
            {
              status: "failed",
              version: "semantic-vision-v1.1",
              judgeJobId: jobId,
              error: body.error.slice(0, 800),
            },
          ).catch((traceError) => {
            console.error("Could not persist semantic judge failure trace", {
              judgeJobId: jobId,
              detail:
                traceError instanceof Error
                  ? traceError.message.slice(0, 500)
                  : "unknown",
            });
          });
        }

        return NextResponse.json({ ok: true, status: "failed" });
      }

      if (!job.personal_use) {
        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt,
          latencyMs: null,
        });

        try {
          await refreshRuntimeContextAfterOutcome({
            ownerRef: job.client_owner_ref,
            jobId,
            conversationId: job.conversation_id,
            requestType: `${job.capability || "text"} / local failure`,
            allowExternalReview: job.routing_preference !== "require-node",
            businessId: job.business_id || null,
          });
        } catch (contextError) {
          console.error("Could not archive local failure context", {
            jobId,
            detail:
              contextError instanceof Error
                ? contextError.message.slice(0, 600)
                : "Unknown context error",
          });
        }
      }

      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.text !== "string" || !body.text.trim() || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const latencyMs = asCount(body.latencyMs);
    const completedAt = new Date().toISOString();
    const provider =
      typeof body.provider === "string"
        ? body.provider.slice(0, 160)
        : "cooperative-local-text-worker";
    const resultModel = body.model.slice(0, 300);

    const webSearchUsed = body.webSearchUsed === true;
    const webAccessMode =
      body.webAccessMode === "auto" || body.webAccessMode === "always"
        ? body.webAccessMode
        : "off";

    if (
      job.capability === "media-judge" &&
      job.routing_mode === "semantic-pairwise-v1"
    ) {
      const originalImageJobId =
        typeof job.source_image_job_id === "string"
          ? job.source_image_job_id
          : null;
      const candidateImageJobId =
        typeof job.comparison_image_job_id === "string"
          ? job.comparison_image_job_id
          : null;

      if (!originalImageJobId || !candidateImageJobId) {
        throw new Error("Pairwise verifier job is missing one of its image jobs.");
      }

      let pairwiseReport: PairwiseVerificationReport;
      try {
        pairwiseReport = parsePairwiseVerificationReport(body.text);
      } catch (parseError) {
        const failureDetail =
          parseError instanceof Error
            ? parseError.message.slice(0, 800)
            : "Pairwise verifier report could not be parsed.";
        const failedAt = new Date().toISOString();

        const { error: failureError } = await supabase
          .from("text_inference_jobs")
          .update({
            status: "failed",
            error: failureDetail,
            result_text: body.text.trim().slice(0, 8000),
            result_model: resultModel,
            result_provider: provider,
            latency_ms: latencyMs,
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", jobId);

        if (failureError) throw failureError;

        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt: failedAt,
          latencyMs,
        });

        return NextResponse.json({
          ok: true,
          status: "failed",
          pairwiseVerificationError: failureDetail,
        });
      }

      const { data: candidateForTargets, error: targetError } =
        await supabase
          .from("inference_jobs")
          .select("repair_plan")
          .eq("id", candidateImageJobId)
          .maybeSingle();
      if (targetError) throw targetError;

      const expectedTargetCategories = repairTargetsFromPlan(
        candidateForTargets?.repair_plan,
      );
      if (!expectedTargetCategories.length) {
        throw new Error(
          "Pairwise verifier has no persisted repair targets to validate.",
        );
      }

      const pairwiseCompletedAt = new Date().toISOString();
      const { error: pairwiseJobUpdateError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "completed",
          partial_text: body.text.trim(),
          result_text: body.text.trim(),
          result_model: resultModel,
          result_provider: provider,
          prompt_tokens: asCount(body.promptTokens),
          output_tokens: asCount(body.outputTokens),
          latency_ms: latencyMs,
          error: null,
          verification_status: "passed",
          completed_at: pairwiseCompletedAt,
          updated_at: pairwiseCompletedAt,
        })
        .eq("id", jobId);

      if (pairwiseJobUpdateError) throw pairwiseJobUpdateError;

      const decision = await persistPairwiseVerification(supabase, {
        originalImageJobId,
        candidateImageJobId,
        verifierJobId: jobId,
        model: resultModel,
        provider,
        latencyMs,
        report: pairwiseReport,
        expectedTargetCategories,
      });

      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "completed",
        completedAt: pairwiseCompletedAt,
        latencyMs,
      });

      await recordModelCapabilityEvidence({
        ownerRef: job.client_owner_ref,
        provider: "cooperative-local",
        model: "local-image-quality",
        endpoint: "",
        routeKind: "image",
        capabilityKey: "pairwise-quality-verifier",
        scope: "semantic-pairwise-v1",
        state: "supported",
        sourceType: "runtime-success",
        sourceRef: jobId,
        confidence: Math.max(
          0.5,
          Math.min(0.99, pairwiseReport.confidence),
        ),
        evidence: {
          originalImageJobId,
          candidateImageJobId,
          judgeModel: resultModel,
          judgeProvider: provider,
          latencyMs,
          report: pairwiseReport,
          decision,
        },
      }).catch((evidenceError) => {
        console.error("Could not record pairwise verifier evidence", {
          verifierJobId: jobId,
          detail:
            evidenceError instanceof Error
              ? evidenceError.message.slice(0, 500)
              : "unknown",
        });
      });

      return NextResponse.json({
        ok: true,
        status: "completed",
        pairwiseVerification: pairwiseReport,
        decision,
      });
    }

    if (job.capability === "media-judge") {
      const sourceImageJobId =
        typeof job.source_image_job_id === "string"
          ? job.source_image_job_id
          : null;

      if (!sourceImageJobId) {
        throw new Error("Semantic media judge job is missing its source image.");
      }

      let report: SemanticJudgeReport;
      try {
        report = parseSemanticJudgeReport(body.text);
      } catch (parseError) {
        const failureDetail =
          parseError instanceof Error
            ? parseError.message.slice(0, 800)
            : "Semantic judge report could not be parsed.";
        const failedAt = new Date().toISOString();

        const { error: failureError } = await supabase
          .from("text_inference_jobs")
          .update({
            status: "failed",
            error: failureDetail,
            result_text: body.text.trim().slice(0, 8000),
            result_model: resultModel,
            result_provider: provider,
            latency_ms: latencyMs,
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", jobId);

        if (failureError) throw failureError;

        await updateSourceSemanticJudgeTrace(supabase, sourceImageJobId, {
          status: "failed",
          version: "semantic-vision-v1",
          judgeJobId: jobId,
          model: resultModel,
          provider,
          latencyMs,
          error: failureDetail,
        }).catch(() => undefined);

        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt: failedAt,
          latencyMs,
        });

        return NextResponse.json({ ok: true, status: "failed" });
      }

      const repairPlan = planMediaRepair(report);
      const semanticCompletedAt = new Date().toISOString();
      const { error: semanticUpdateError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "completed",
          partial_text: body.text.trim(),
          result_text: body.text.trim(),
          result_model: resultModel,
          result_provider: provider,
          prompt_tokens: asCount(body.promptTokens),
          output_tokens: asCount(body.outputTokens),
          latency_ms: latencyMs,
          error: null,
          verification_status: "passed",
          completed_at: semanticCompletedAt,
          updated_at: semanticCompletedAt,
        })
        .eq("id", jobId);

      if (semanticUpdateError) throw semanticUpdateError;

      await updateSourceSemanticJudgeTrace(supabase, sourceImageJobId, {
        status: "completed",
        version: report.version,
        judgeJobId: jobId,
        model: resultModel,
        provider,
        latencyMs,
        report,
        repairPlan,
      });

      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "completed",
        completedAt: semanticCompletedAt,
        latencyMs,
      });

      await recordSemanticJudgeEvidence({
        ownerRef: job.client_owner_ref,
        judgeJobId: jobId,
        sourceImageJobId,
        model: resultModel,
        provider,
        latencyMs,
        report,
      }).catch((evidenceError) => {
        console.error("Could not record semantic judge evidence", {
          judgeJobId: jobId,
          detail:
            evidenceError instanceof Error
              ? evidenceError.message.slice(0, 500)
              : "unknown",
        });
      });

      let automaticRepairCandidateJobId: string | null = null;
      if (repairPlan.autoRepairEligible) {
        try {
          automaticRepairCandidateJobId =
            await enqueueAutomaticRepairCandidate(supabase, {
              sourceImageJobId,
              ownerRef: job.client_owner_ref,
              semanticJudgeJobId: jobId,
              repairPlan,
            });
        } catch (repairError) {
          console.error("Could not enqueue automatic bounded repair candidate", {
            sourceImageJobId,
            semanticJudgeJobId: jobId,
            detail:
              repairError instanceof Error
                ? repairError.message.slice(0, 500)
                : "unknown",
          });
        }
      }

      let pairwiseVerifierJobId: string | null = null;
      try {
        const { data: candidateJob, error: candidateError } = await supabase
          .from("inference_jobs")
          .select("parent_image_job_id,pipeline_role,repair_plan")
          .eq("id", sourceImageJobId)
          .maybeSingle();

        if (candidateError) throw candidateError;

        if (
          candidateJob?.pipeline_role === "repair-candidate" &&
          typeof candidateJob.parent_image_job_id === "string"
        ) {
          const { data: originalJob, error: originalError } = await supabase
            .from("inference_jobs")
            .select("prompt,pipeline_trace")
            .eq("id", candidateJob.parent_image_job_id)
            .maybeSingle();

          if (originalError) throw originalError;

          const originalTrace =
            originalJob?.pipeline_trace &&
            typeof originalJob.pipeline_trace === "object" &&
            !Array.isArray(originalJob.pipeline_trace)
              ? (originalJob.pipeline_trace as {
                  semanticJudge?: { repairPlan?: unknown };
                })
              : {};

          const targetCategories = repairTargetsFromPlan(
            candidateJob.repair_plan &&
              typeof candidateJob.repair_plan === "object" &&
              !Array.isArray(candidateJob.repair_plan) &&
              Object.keys(candidateJob.repair_plan).length
              ? candidateJob.repair_plan
              : originalTrace.semanticJudge?.repairPlan,
          );

          pairwiseVerifierJobId = await enqueuePairwiseVerifier(supabase, {
            ownerRef: job.client_owner_ref,
            workerId,
            originalImageJobId: candidateJob.parent_image_job_id,
            candidateImageJobId: sourceImageJobId,
            sourcePrompt:
              typeof originalJob?.prompt === "string" ? originalJob.prompt : "",
            targetCategories,
          });
        }
      } catch (pairwiseError) {
        console.error("Could not enqueue pairwise media verifier", {
          candidateImageJobId: sourceImageJobId,
          detail:
            pairwiseError instanceof Error
              ? pairwiseError.message.slice(0, 500)
              : "unknown",
        });
      }

      return NextResponse.json({
        ok: true,
        status: "completed",
        semanticJudge: report,
        repairPlan,
        automaticRepairCandidateJobId,
        pairwiseVerifierJobId,
      });
    }

    const jobUpdate: Record<string, unknown> = {
      status: "completed",
      partial_text: job.personal_use ? null : body.text,
      result_text: job.personal_use ? null : body.text,
      result_model: resultModel,
      result_provider: provider,
      prompt_tokens: asCount(body.promptTokens),
      output_tokens: asCount(body.outputTokens),
      latency_ms: latencyMs,
      error: null,
      completed_at: completedAt,
      updated_at: completedAt,
      ...(webSearchUsed
        ? {
            route_reason: `${job.route_reason || ""} Profile Web ${webAccessMode} authorized a public search on the selected node; model inference remained local.`.trim(),
          }
        : {}),
    };
    if (job.personal_use) {
      jobUpdate.messages = [
        { role: "system", content: "Personal AI payload removed after local execution." },
      ];
    }

    const { error: updateError } = await supabase
      .from("text_inference_jobs")
      .update(jobUpdate)
      .eq("id", jobId);

    if (updateError) throw updateError;

    if (job.personal_use) {
      if (!job.personal_user_id || !job.personal_conversation_id) {
        throw new Error("Personal AI completion is missing its user or conversation.");
      }

      const { error: personalMessageError } = await supabase.rpc(
        "personal_ai_append_message",
        {
          p_user_id: job.personal_user_id,
          p_conversation_id: job.personal_conversation_id,
          p_role: "assistant",
          p_content: body.text.trim(),
          p_source: "node",
          p_source_job_id: jobId,
          p_metadata: {
            model: resultModel,
            provider,
            promptTokens: asCount(body.promptTokens),
            outputTokens: asCount(body.outputTokens),
            latencyMs,
            workerId,
            webSearchUsed,
            webAccessMode,
          },
        },
      );
      if (personalMessageError) throw personalMessageError;
    } else {
      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "completed",
        completedAt,
        latencyMs,
      });
    }

    if (job.conversation_id) {
      const { error: messageError } = await supabase.from("local_ai_messages").upsert(
        {
          conversation_id: job.conversation_id,
          owner_ref: job.client_owner_ref,
          role: "assistant",
          content: body.text.trim(),
          job_id: jobId,
        },
        { onConflict: "job_id,role" },
      );

      if (messageError) throw messageError;

      const { error: conversationError } = await supabase
        .from("local_ai_conversations")
        .update({ updated_at: completedAt })
        .eq("id", job.conversation_id)
        .eq("owner_ref", job.client_owner_ref);

      if (conversationError) throw conversationError;

      if (
        (job.capability === "text" || job.capability === "vision") &&
        job.routing_preference !== "require-node"
      ) {
        const parsedMessages = z
          .array(textInferenceMessageSchema)
          .min(1)
          .max(40)
          .safeParse(job.messages);
        if (parsedMessages.success) {
          try {
            await persistResponseSupport({
              ownerRef: job.client_owner_ref,
              conversationId: job.conversation_id,
              jobId,
              messages: parsedMessages.data,
              answer: body.text.trim(),
              provider,
              model: resultModel,
              businessId: job.business_id || null,
            });
          } catch (supportError) {
            console.error("Could not persist local response support", {
              jobId,
              detail:
                supportError instanceof Error
                  ? supportError.message.slice(0, 600)
                  : "Unknown support error",
            });
          }
        }
      }
    }

    if (!job.personal_use) {
      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef: job.client_owner_ref,
          jobId,
          conversationId: job.conversation_id,
          requestType: `${job.capability || "text"} / local success`,
          allowExternalReview: job.routing_preference !== "require-node",
          businessId: job.business_id || null,
        });
      } catch (contextError) {
        console.error("Could not refresh local runtime context", {
          jobId,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete text inference job.";
    console.error("CoOperative text inference completion failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not complete text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
