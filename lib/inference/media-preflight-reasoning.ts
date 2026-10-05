import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import {
  cancelHermesTextTask,
  pollHermesTextTask,
  startHermesTextTask,
  type HermesTextContextMessage,
} from "@/lib/inference/hermes-text-cloud";
import type {
  MediaRecommendationOption,
} from "@/lib/inference/media-recommendations";
import type { MediaRequestPlan } from "@/lib/inference/media-request";
import { preferredOwnedTextNode } from "@/lib/unison/owned-text-routing";
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
};

const LOCAL_QUEUE_GRACE_MS = 8_000;
const LOCAL_TOTAL_WAIT_MS = 16_000;
const FREE_TOTAL_WAIT_MS = 55_000;
const FREE_WORKER_ID = "cooperative-hermes-free-media-planner";

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

  if (
    selected.provider === "cooperative-local" ||
    selected.providerCostEstimateUsd <= 0
  ) {
    return [];
  }

  const eligible = options.filter(
    (option) =>
      option.executionReady &&
      option.capUsd <= requestCapUsd + 0.000001,
  );
  const signals: string[] = [];

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
) {
  while (Date.now() - startedAt < LOCAL_TOTAL_WAIT_MS) {
    const { data, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,result_text,error,worker_id,claimed_at,created_at,updated_at",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (data.status === "completed" && data.result_text) {
      return { state: "completed" as const, text: String(data.result_text) };
    }
    if (data.status === "failed" || data.status === "cancelled") {
      return { state: "failed" as const, text: null };
    }

    const age = Date.now() - startedAt;
    if (age >= LOCAL_QUEUE_GRACE_MS && data.status === "queued" && !data.worker_id) {
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
        "Deterministic media preparation lacked enough confidence and owned/local planning did not complete in the bounded window, so CoOperative used strict-free reasoning before any paid media call.",
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
      fallback_model: "openrouter/free",
    });
  if (insertError) throw insertError;

  let started;
  try {
    started = await startHermesTextTask({
      jobId: fallbackId,
      messages: input.messages,
      openRouterCredential: credential,
    });
  } catch (error) {
    await input.admin
      .from("text_inference_jobs")
      .update({
        status: "failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 1200)
            : "Strict-free media planning could not start.",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fallbackId);
    return null;
  }

  await input.admin
    .from("text_inference_jobs")
    .update({
      fallback_provider: started.provider,
      fallback_model: started.model,
      fallback_sandbox_name: started.sandboxName,
      fallback_deadline_at: started.deadlineAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fallbackId);

  const waitUntil = Math.min(
    Date.parse(started.deadlineAt),
    Date.now() + FREE_TOTAL_WAIT_MS,
  );
  while (Date.now() < waitUntil) {
    const polled = await pollHermesTextTask({
      sandboxName: started.sandboxName,
      deadlineAt: started.deadlineAt,
    });

    if (polled.state === "completed" && polled.text) {
      const completedAt = new Date().toISOString();
      await input.admin
        .from("text_inference_jobs")
        .update({
          status: "completed",
          result_text: polled.text,
          partial_text: polled.text,
          result_model: started.model,
          result_provider: "openrouter-free",
          fallback_usage: polled.usage,
          error: null,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", fallbackId);
      return polled.text;
    }

    if (polled.state === "failed") {
      const failedAt = new Date().toISOString();
      await input.admin
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error: (polled.error || "Strict-free media planning failed.").slice(
            0,
            1200,
          ),
          fallback_usage: polled.usage,
          completed_at: failedAt,
          updated_at: failedAt,
        })
        .eq("id", fallbackId);
      return null;
    }

    await sleep(750);
  }

  await cancelHermesTextTask(started.sandboxName).catch(() => false);
  const failedAt = new Date().toISOString();
  await input.admin
    .from("text_inference_jobs")
    .update({
      status: "failed",
      error:
        "Strict-free media planning exceeded CoOperative's bounded preparation window.",
      completed_at: failedAt,
      updated_at: failedAt,
    })
    .eq("id", fallbackId);
  return null;
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
    };
  }

  const messages = reasoningMessages({ ...input, signals });
  const ownedNode = await preferredOwnedTextNode(input.admin, input.userId);
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
      max_tokens: 1000,
      temperature: 0.1,
      routing_mode: "local-fast",
      task_class: "media-planning",
      route_reason:
        "Deterministic code found the media request executable but not sufficiently specified to guarantee the best eligible model and provider-ready prompt before a paid generation call.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      capability: "text",
      routing_preference: ownedNode ? "prefer-owned" : "default",
      preferred_node_id: ownedNode?.id ?? null,
      queued_at: queuedAt,
    });
  if (localInsertError) throw localInsertError;

  const localResult = await readLocalPreparation(
    input.admin,
    localJobId,
    Date.now(),
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

  const freeText = await runFreePreparation({
    admin: input.admin,
    ownerRef: input.ownerRef,
    messages,
    rootJobId: localJobId,
  });

  if (freeText) {
    const parsed = parsePreparation(
      freeText,
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
  };
}
