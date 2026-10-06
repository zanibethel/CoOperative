import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import { preferredRegistryFreeTextModel } from "@/lib/inference/model-capability-registry";
import type { HermesTextContextMessage } from "@/lib/inference/hermes-text-cloud";
import type {
  MediaRecommendationOption,
} from "@/lib/inference/media-recommendations";
import type { MediaRequestPlan } from "@/lib/inference/media-request";
import {
  preferredOwnedMediaPlanningNode,
} from "@/lib/unison/owned-text-routing";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type MediaPreparationResult = {
  usedReasoning: boolean;
  source: "deterministic" | "local" | "free-cloud";
  model: string;
  prompt: string;
  confidence: number | null;
  reason: string;
  signals: string[];
  planner: {
    jobId: string;
    provider: string;
    model: string;
    workerId: string | null;
  } | null;
};

const LOCAL_QUEUE_GRACE_MS = 4_000;
const LOCAL_TOTAL_WAIT_MS = 8_000;
const FREE_TOTAL_WAIT_MS = 10_000;
const FREE_WORKER_ID = "cooperative-openrouter-free-media-planner";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promptWordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function mediaPreparationSignals(input: {
  userRequest: string;
  plan: MediaRequestPlan;
  selected: MediaRecommendationOption;
  options: MediaRecommendationOption[];
  requestCapUsd: number;
  requiresReferenceImage: boolean;
  explicitTierSelected: boolean;
}) {
  const {
    userRequest,
    plan,
    selected,
    options,
    requestCapUsd,
    requiresReferenceImage,
    explicitTierSelected,
  } = input;

  const eligible = options.filter(
    (option) =>
      option.executionReady &&
      option.capUsd <= requestCapUsd + 0.000001,
  );
  const signals: string[] = [];

  if (
    plan.kind === "image" &&
    (selected.provider === "cooperative-local" ||
      selected.providerCostEstimateUsd <= 0)
  ) {
    signals.push(
      "the zero-provider-cost image route can benefit from a bounded reasoning pass before rendering",
    );
  }

  if (!explicitTierSelected && eligible.length > 1) {
    signals.push("multiple execution-ready routes fit the approved budget");
  }
  if (requiresReferenceImage) {
    signals.push("reference-image intent benefits from semantic prompt preparation");
  }
  if (promptWordCount(userRequest) < 28) {
    signals.push("the user request is concise enough that provider-ready details may be underspecified");
  }
  if (
    /\b(same|similar|like this|match|preserve|keep|best|high quality|realistic|cinematic|style|face|body|identity)\b/i.test(
      userRequest,
    )
  ) {
    signals.push("the request contains semantic visual constraints not fully represented by deterministic controls");
  }
  if (
    selected.scorecard.qualitySource === "heuristic" &&
    eligible.some((option) => option.model !== selected.model)
  ) {
    signals.push("route quality is still partly heuristic rather than fully benchmark-backed");
  }
  if (plan.kind === "video" && (plan.resolution === null || plan.audio === null)) {
    signals.push("one or more video quality controls were not explicitly specified");
  }

  return [...new Set(signals)];
}

function reasoningMessages(input: {
  userRequest: string;
  plan: MediaRequestPlan;
  selected: MediaRecommendationOption;
  options: MediaRecommendationOption[];
  requestCapUsd: number;
  requiresReferenceImage: boolean;
  signals: string[];
}): HermesTextContextMessage[] {
  const eligible = input.options.filter(
    (option) =>
      option.executionReady &&
      option.capUsd <= input.requestCapUsd + 0.000001,
  );

  const candidateSummary = eligible
    .map((option) => ({
      provider: option.provider,
      model: option.model,
      name: option.modelName,
      tier: option.tier,
      quotedCostUsd: option.estimatedCostUsd,
      providerCostUsd: option.providerCostEstimateUsd,
      resolution: option.resolution,
      audio: option.audio,
      referenceBehavior: option.referenceBehavior,
      qualityScore: option.scorecard.qualityScore,
      qualitySource: option.scorecard.qualitySource,
      selectionBasis: option.scorecard.selectionBasis,
      adultCapability: option.adultCapability,
    }));

  return [
    {
      role: "system",
      content: [
        "You are CoOperative's bounded media preparation planner.",
        "Deterministic code has already enforced provider eligibility, content settings, capability evidence, live pricing, and the user's spend cap.",
        "Your only job is to improve model choice among the supplied eligible candidates and rewrite the user's request into a strong provider-ready generation prompt.",
        "Think explicitly about composition, subject relationships, anatomy, hands, faces, lighting, camera/framing, background integrity, and likely generation failure modes, then encode only useful refinements into the final prompt.",
        "Do not invent a model outside the supplied candidates.",
        "Do not increase cost beyond the supplied cap.",
        "Do not weaken or broaden content-policy or capability constraints.",
        "Preserve the user's requested subject, identity/reference intent, medium, adult-content scope, aspect ratio, resolution, duration, and audio constraints exactly.",
        "Do not add new sexual acts, people, ages, identities, or sensitive attributes that the user did not request.",
        "Return ONLY compact JSON with keys: model, prompt, confidence, reason.",
        "confidence must be a number from 0 to 1.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          request: input.userRequest,
          deterministicPlan: input.plan,
          deterministicSelection: {
            provider: input.selected.provider,
            model: input.selected.model,
            tier: input.selected.tier,
          },
          requestCapUsd: input.requestCapUsd,
          requiresReferenceImage: input.requiresReferenceImage,
          lowConfidenceSignals: input.signals,
          eligibleCandidates: candidateSummary,
        },
        null,
        2,
      ),
    },
  ];
}

function parsePreparation(
  text: string,
  fallbackModel: string,
  fallbackPrompt: string,
) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      model?: unknown;
      prompt?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    const model =
      typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model.trim()
        : fallbackModel;
    const prompt =
      typeof parsed.prompt === "string" && parsed.prompt.trim().length >= 12
        ? parsed.prompt.trim().slice(0, 12000)
        : fallbackPrompt;
    const confidence =
      typeof parsed.confidence === "number" &&
      Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : null;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 1000)
        : "Reasoning planner refined the provider-ready request.";

    return { model, prompt, confidence, reason };
  } catch {
    return null;
  }
}

async function readLocalPreparation(
  admin: AdminClient,
  jobId: string,
  startedAt: number,
  options?: { totalWaitMs?: number; queueGraceMs?: number },
) {
  const totalWaitMs = options?.totalWaitMs ?? LOCAL_TOTAL_WAIT_MS;
  const queueGraceMs = options?.queueGraceMs ?? LOCAL_QUEUE_GRACE_MS;

  while (Date.now() - startedAt < totalWaitMs) {
    const { data, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,result_text,result_model,result_provider,error,worker_id,claimed_at,created_at,updated_at",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (data.status === "completed" && data.result_text) {
      return {
        state: "completed" as const,
        text: String(data.result_text),
        provider:
          typeof data.result_provider === "string" && data.result_provider
            ? data.result_provider
            : "cooperative-local",
        model:
          typeof data.result_model === "string" && data.result_model
            ? data.result_model
            : "local-text",
        workerId:
          typeof data.worker_id === "string" && data.worker_id
            ? data.worker_id
            : null,
      };
    }
    if (data.status === "failed" || data.status === "cancelled") {
      return { state: "failed" as const, text: null };
    }

    const age = Date.now() - startedAt;
    if (age >= queueGraceMs && data.status === "queued" && !data.worker_id) {
      return { state: "unclaimed" as const, text: null };
    }

    await sleep(500);
  }

  return { state: "timed-out" as const, text: null };
}

async function runFreePreparation(input: {
  admin: AdminClient;
  ownerRef: string;
  messages: HermesTextContextMessage[];
  rootJobId: string;
}) {
  const connected = await businessOwnedServiceCredentialForOwner(
    input.ownerRef,
    "openrouter-api",
  );
  const credential =
    connected?.credential || process.env.OPENROUTER_API_KEY?.trim() || null;
  if (!credential) return null;

  const fallbackModel =
    (await preferredRegistryFreeTextModel({
      requireReasoning: true,
      requireStructuredOutput: true,
    })) || "openrouter/free";
  const fallbackId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: insertError } = await input.admin
    .from("text_inference_jobs")
    .insert({
      id: fallbackId,
      status: "running",
      client_owner_ref: input.ownerRef,
      messages: input.messages,
      profile: "fast",
      max_tokens: 1000,
      temperature: 0.1,
      routing_mode: "free-cloud",
      task_class: "media-planning",
      route_reason:
        "Deterministic media preparation lacked enough confidence and owned/local planning did not complete in the bounded window, so CoOperative used the connected OpenRouter strict-free router directly before any paid media call.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      capability: "text",
      routing_preference: "default",
      fallback_for_job_id: input.rootJobId,
      worker_id: FREE_WORKER_ID,
      claimed_at: now,
      fallback_attempted_at: now,
      fallback_provider: "openrouter",
      fallback_model: fallbackModel,
    });
  if (insertError) throw insertError;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FREE_TOTAL_WAIT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative",
      },
      body: JSON.stringify({
        model: fallbackModel,
        messages: input.messages,
        max_tokens: 1000,
        temperature: 0.1,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload) {
      const detail =
        payload?.error?.message ||
        raw.slice(0, 800) ||
        `OpenRouter strict-free planning returned HTTP ${response.status}.`;
      throw new Error(detail);
    }

    const content = payload?.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((part: any) =>
                typeof part?.text === "string" ? part.text : "",
              )
              .filter(Boolean)
              .join("\n")
              .trim()
          : "";

    if (!text) {
      throw new Error("OpenRouter strict-free planning returned no usable text.");
    }

    const completedAt = new Date().toISOString();
    await input.admin
      .from("text_inference_jobs")
      .update({
        status: "completed",
        result_text: text,
        partial_text: text,
        result_model:
          typeof payload.model === "string" && payload.model
            ? payload.model
            : fallbackModel,
        result_provider: "openrouter-free",
        prompt_tokens:
          typeof payload?.usage?.prompt_tokens === "number"
            ? Math.max(0, Math.round(payload.usage.prompt_tokens))
            : null,
        output_tokens:
          typeof payload?.usage?.completion_tokens === "number"
            ? Math.max(0, Math.round(payload.usage.completion_tokens))
            : null,
        fallback_usage:
          payload?.usage && typeof payload.usage === "object"
            ? payload.usage
            : null,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", fallbackId);

    return {
      text,
      jobId: fallbackId,
      provider: "openrouter-free",
      model:
        typeof payload.model === "string" && payload.model
          ? payload.model
          : fallbackModel,
      workerId: FREE_WORKER_ID,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const detail =
      error instanceof Error
        ? error.name === "AbortError"
          ? "Strict-free media planning exceeded the 10-second total API window."
          : error.message
        : "Strict-free media planning failed.";

    await input.admin
      .from("text_inference_jobs")
      .update({
        status: "failed",
        error: detail.slice(0, 1200),
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", fallbackId);

    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function prepareMediaExecutionWithReasoning(input: {
  admin: AdminClient;
  ownerRef: string;
  userId: string;
  userRequest: string;
  deterministicPrompt: string;
  plan: MediaRequestPlan;
  selected: MediaRecommendationOption;
  options: MediaRecommendationOption[];
  requestCapUsd: number;
  requiresReferenceImage: boolean;
  explicitTierSelected: boolean;
}): Promise<MediaPreparationResult> {
  const signals = mediaPreparationSignals(input);
  if (!signals.length) {
    return {
      usedReasoning: false,
      source: "deterministic",
      model: input.selected.model,
      prompt: input.deterministicPrompt,
      confidence: null,
      reason: "Deterministic media routing had enough information to proceed.",
      signals,
      planner: null,
    };
  }

  const messages = reasoningMessages({ ...input, signals });
  const ownedNode = await preferredOwnedMediaPlanningNode(
    input.admin,
    input.userId,
  );
  const specialistPlanner =
    ownedNode?.specialization === "media-planning";
  const localJobId = crypto.randomUUID();
  const queuedAt = new Date().toISOString();

  const { error: localInsertError } = await input.admin
    .from("text_inference_jobs")
    .insert({
      id: localJobId,
      status: "queued",
      client_owner_ref: input.ownerRef,
      messages,
      profile: "fast",
      max_tokens: specialistPlanner ? 384 : 700,
      temperature: 0.1,
      routing_mode: specialistPlanner
        ? "cross-device-media-planning-v1"
        : "local-fast",
      task_class: "media-planning",
      route_reason: specialistPlanner
        ? `CoOperative assigned bounded image-job reasoning to the owned media-planning specialist node ${ownedNode?.displayName || ownedNode?.id} before rendering.`
        : "Deterministic code found the media request executable but benefits from a bounded owned/local reasoning pass before generation.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      capability: "text",
      routing_preference: specialistPlanner
        ? "require-node"
        : ownedNode
          ? "prefer-owned"
          : "default",
      preferred_node_id: ownedNode?.id ?? null,
      target_node_id: specialistPlanner ? ownedNode?.id ?? null : null,
      queued_at: queuedAt,
    });
  if (localInsertError) throw localInsertError;

  const localResult = await readLocalPreparation(
    input.admin,
    localJobId,
    Date.now(),
    specialistPlanner
      ? { totalWaitMs: 14_000, queueGraceMs: 5_000 }
      : undefined,
  );

  if (localResult?.state === "completed" && localResult.text) {
    const parsed = parsePreparation(
      localResult.text,
      input.selected.model,
      input.deterministicPrompt,
    );
    if (parsed) {
      const allowedModel = input.options.some(
        (option) =>
          option.executionReady &&
          option.capUsd <= input.requestCapUsd + 0.000001 &&
          option.model === parsed.model,
      );
      return {
        usedReasoning: true,
        source: "local",
        model: allowedModel ? parsed.model : input.selected.model,
        prompt: parsed.prompt,
        confidence: parsed.confidence,
        reason: parsed.reason,
        signals,
        planner: {
          jobId: localJobId,
          provider: localResult.provider,
          model: localResult.model,
          workerId: localResult.workerId,
        },
      };
    }
  }

  await input.admin
    .from("text_inference_jobs")
    .update({
      status: "cancelled",
      error:
        "Media preparation moved to strict-free reasoning after the bounded owned/local window.",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", localJobId)
    .in("status", ["queued", "running"]);

  const freeResult = await runFreePreparation({
    admin: input.admin,
    ownerRef: input.ownerRef,
    messages,
    rootJobId: localJobId,
  });

  if (freeResult) {
    const parsed = parsePreparation(
      freeResult.text,
      input.selected.model,
      input.deterministicPrompt,
    );
    if (parsed) {
      const allowedModel = input.options.some(
        (option) =>
          option.executionReady &&
          option.capUsd <= input.requestCapUsd + 0.000001 &&
          option.model === parsed.model,
      );
      return {
        usedReasoning: true,
        source: "free-cloud",
        model: allowedModel ? parsed.model : input.selected.model,
        prompt: parsed.prompt,
        confidence: parsed.confidence,
        reason: parsed.reason,
        signals,
        planner: {
          jobId: freeResult.jobId,
          provider: freeResult.provider,
          model: freeResult.model,
          workerId: freeResult.workerId,
        },
      };
    }
  }

  return {
    usedReasoning: false,
    source: "deterministic",
    model: input.selected.model,
    prompt: input.deterministicPrompt,
    confidence: null,
    reason:
      "Local/free preparation did not return a valid bounded plan, so CoOperative preserved the deterministic route and prompt rather than spending more.",
    signals,
    planner: null,
  };
}
