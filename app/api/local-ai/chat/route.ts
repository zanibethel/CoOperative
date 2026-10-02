import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import {
  COOPERATIVE_BUSINESS_CHAT_POLICY,
  COOPERATIVE_BUSINESS_POLICY_REVISION,
} from "@/lib/ai/business-chat-policy";
import { buildBusinessChatContext } from "@/lib/ai/business-context";
import { aiProfileBalanceForUser } from "@/lib/billing/ai-profile-balance";
import { handleBusinessIntake } from "@/lib/runtime/business-intake";
import { activeNodeIds } from "@/lib/unison/node-access";
import {
  hermesMediaConfiguration,
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import {
  mediaPromptWithResolvedControls,
  planMediaRequest,
} from "@/lib/inference/media-request";
import {
  openRouterMediaCatalog,
  recommendedForRequest,
  type MediaCatalogModel,
} from "@/lib/inference/openrouter-media-catalog";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import {
  looksLikeApiCredential,
  planServiceConnectIntent,
  serviceConnectAssistantMessage,
} from "@/lib/runtime/service-connect-intent";
import { startRecoveryForJob } from "@/lib/recovery/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const modelMixerLevelSchema = z.number().int().min(0).max(4);
const modelMixerSchema = z.object({
  preset: z.enum(["economy", "balanced", "premium", "custom"]),
  maxSpendUsd: z.number().min(0).max(100),
  agents: z.object({
    research: modelMixerLevelSchema,
    planner: modelMixerLevelSchema,
    builder: modelMixerLevelSchema,
    verifier: modelMixerLevelSchema,
    media: modelMixerLevelSchema,
  }),
});

const chatRequestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    businessId: z.string().uuid().optional(),
    message: z.string().max(16000).default(""),
    attachmentIds: z.array(z.string().uuid()).max(4).default([]),
    profile: z.enum(["fast", "quality"]).default("fast"),
    maxTokens: z.number().int().min(16).max(4096).default(768),
    temperature: z.number().min(0).max(2).default(0.2),
    nodeRouting: z.enum(["default", "prefer-owned", "require-node"]).default("default"),
    requiredNodeId: z.string().min(1).max(160).optional(),
    modelMixer: modelMixerSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.message.trim()) || value.attachmentIds.length > 0,
    "Message or image attachment is required.",
  );

async function currentOwner() {
  const userId = await authenticatedUserId();

  return userId
    ? { userId, ownerRef: `coop-user:${userId}` }
    : null;
}

function titleFromMessage(message: string, hasImages: boolean) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return hasImages ? "Image question" : "New chat";
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

function asksAboutRecentFailure(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bwhat caused (the )?(failure|error)\b/.test(value) ||
    /\bwhy did (it|that|this).{0,40}(fail|error)\b/.test(value) ||
    /\bwhat (went wrong|happened)\b/.test(value) ||
    /\bwhy (did )?(it|that|this) fail\b/.test(value) ||
    /\bload failed\b/.test(value)
  );
}

function asksToRetryRecentMedia(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bretry (that|the|this|my|last)?\s*(image|video|media|generation)?\b/.test(value) ||
    /\btry (that|the|this|my|last)?\s*(image|video|media)?\s*again\b/.test(value) ||
    /\brun (that|the|this|my|last)?\s*(image|video|media)?\s*again\b/.test(value) ||
    /\bretry it\b/.test(value)
  );
}

function conciseFailureDetail(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function providerCreditBoundary(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.toLowerCase();
  return (
    text.includes("402") ||
    text.includes("insufficient credits") ||
    text.includes("purchase credits") ||
    text.includes("billing issue") ||
    text.includes("billing") ||
    text.includes("not entitled") ||
    text.includes("subscription credit")
  );
}

function aspectRatioFromPrompt(value: string) {
  const match = value.match(/\b(1:1|4:5|3:2|16:9|9:16)\b/);
  return match?.[1] || "4:5";
}

function estimatedMediaProviderCostUsd(
  model: MediaCatalogModel,
  durationSeconds: number | null,
) {
  const unitCost = model.minUnitCostUsd;
  if (unitCost === null) return null;
  if (model.unit === "second") {
    return durationSeconds ? unitCost * durationSeconds : null;
  }
  if (model.unit === "image") return unitCost;
  return model.free ? 0 : null;
}

const DEFAULT_TEST_SPEND_USD = 0.05;

type NousManagedMediaChoice = {
  model: string;
  estimatedCostUsd: number;
  pricingSource: string;
};

function nousManagedMediaChoice(
  kind: "image" | "video",
  mediaLevel: 0 | 1 | 2 | 3 | 4,
  requestCapUsd: number,
  durationSeconds: number | null,
): NousManagedMediaChoice | null {
  if (requestCapUsd <= 0) return null;

  if (kind === "image") {
    const candidates: Array<{
      minLevel: number;
      model: string;
      estimatedCostUsd: number;
    }> = [
      {
        minLevel: 0,
        model: "fal-ai/flux-2/klein/9b",
        estimatedCostUsd: 0.01,
      },
      {
        minLevel: 2,
        model: "fal-ai/qwen-image",
        estimatedCostUsd: 0.03,
      },
      {
        minLevel: 3,
        model: "fal-ai/gpt-image-1.5",
        estimatedCostUsd: 0.04,
      },
      {
        minLevel: 4,
        model: "fal-ai/gpt-image-2",
        estimatedCostUsd: 0.06,
      },
    ];

    const affordable = candidates
      .filter(
        (candidate) =>
          candidate.minLevel <= mediaLevel &&
          candidate.estimatedCostUsd <= requestCapUsd,
      )
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)[0];

    return affordable
      ? {
          model: affordable.model,
          estimatedCostUsd: affordable.estimatedCostUsd,
          pricingSource: "nous-managed-planning-estimate",
        }
      : null;
  }

  const duration = durationSeconds || 5;
  const estimatedCostUsd = duration * 0.05;
  if (estimatedCostUsd > requestCapUsd) return null;

  return {
    model: mediaLevel >= 2 ? "seedance-2.0-mini" : "pixverse-v6",
    estimatedCostUsd,
    pricingSource: "nous-managed-video-planning-estimate",
  };
}

function affordableOpenRouterModel(
  models: MediaCatalogModel[],
  level: 0 | 1 | 2 | 3 | 4,
  request: { durationSeconds?: number | null; aspectRatio?: string | null },
  capUsd: number,
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
    return durationOk && aspectOk;
  });
  const pool = capable.length ? capable : models;
  const requested = recommendedForRequest(pool, level, request);
  const requestedCost = requested
    ? estimatedMediaProviderCostUsd(requested, request.durationSeconds || null)
    : null;

  if (
    requested &&
    requestedCost !== null &&
    requestedCost <= capUsd
  ) {
    return { model: requested, estimatedCostUsd: requestedCost };
  }

  const affordable = pool
    .map((model) => ({
      model,
      estimatedCostUsd: estimatedMediaProviderCostUsd(
        model,
        request.durationSeconds || null,
      ),
    }))
    .filter(
      (
        row,
      ): row is { model: MediaCatalogModel; estimatedCostUsd: number } =>
        row.estimatedCostUsd !== null && row.estimatedCostUsd <= capUsd,
    )
    .sort((a, b) => {
      if (a.model.free !== b.model.free) return a.model.free ? 1 : -1;
      return b.estimatedCostUsd - a.estimatedCostUsd;
    })[0];

  return affordable || null;
}

function mediaBudgetSuggestion(
  kind: "image" | "video",
  capUsd: number,
  estimateUsd: number | null,
) {
  if (kind === "video") {
    const suggested = Math.max(0.25, estimateUsd || 0);
    return (
      `Paid video is unlikely to fit inside a ${capUsd.toFixed(2)} cap. ` +
      `Keep the cap and lower the quality/duration, use a free route if one is available, or raise this request to about ${suggested.toFixed(2)} for a short paid-video test.`
    );
  }

  const suggested = Math.max(0.1, estimateUsd || 0);
  return (
    `I could not find a paid image route that fits the current ${capUsd.toFixed(2)} cap. ` +
    `I can lower the Media quality, use local/free generation, or raise this request to about ${suggested.toFixed(2)}.`
  );
}

export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = chatRequestSchema.parse(await request.json());
    if (looksLikeApiCredential(input.message)) {
      return NextResponse.json(
        {
          error:
            "Don't paste API keys into normal chat. Ask me to connect the provider and I'll show a secure credential field.",
          code: "SECURE_CREDENTIAL_REQUIRED",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const admin = createAdminSupabaseClient();
    const ownerRef = owner.ownerRef;
    const businessContext = await buildBusinessChatContext(
      owner.userId,
      input.businessId,
    );
    const profileBalance =
      businessContext?.aiBalance ?? (await aiProfileBalanceForUser(owner.userId));

    let conversationId = input.conversationId;
    let conversationTitle = "";

    if (conversationId) {
      const { data: existing, error: conversationError } = await admin
        .from("local_ai_conversations")
        .select("id,title")
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();

      if (conversationError) throw conversationError;
      if (!existing) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
      conversationTitle = existing.title;
    } else {
      conversationId = crypto.randomUUID();
      conversationTitle = titleFromMessage(input.message, input.attachmentIds.length > 0);

      const { error: createError } = await admin.from("local_ai_conversations").insert({
        id: conversationId,
        owner_ref: ownerRef,
        title: conversationTitle,
        profile: input.profile,
      });

      if (createError) throw createError;
    }

    let currentAttachmentIds = input.attachmentIds;

    if (input.attachmentIds.length > 0) {
      const { data: attachments, error: attachmentError } = await admin
        .from("local_ai_attachments")
        .select("id,conversation_id")
        .eq("owner_ref", ownerRef)
        .in("id", input.attachmentIds);

      if (attachmentError) throw attachmentError;
      if (!attachments || attachments.length !== input.attachmentIds.length) {
        return NextResponse.json(
          { error: "One or more image attachments were not found." },
          { status: 400 },
        );
      }

      const belongsElsewhere = attachments.some(
        (attachment) =>
          attachment.conversation_id && attachment.conversation_id !== conversationId,
      );
      if (belongsElsewhere) {
        return NextResponse.json(
          { error: "An image attachment belongs to another conversation." },
          { status: 409 },
        );
      }

      const { error: attachError } = await admin
        .from("local_ai_attachments")
        .update({ conversation_id: conversationId })
        .in("id", input.attachmentIds)
        .eq("owner_ref", ownerRef);

      if (attachError) throw attachError;
    }


    const { data: recentAssistantRows, error: recentAssistantError } = await admin
      .from("local_ai_messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", ownerRef)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(8);
    if (recentAssistantError) throw recentAssistantError;

    const serviceConnectIntent = planServiceConnectIntent(
      input.message,
      (recentAssistantRows || []).map((row) => row.content || ""),
    );

    if (serviceConnectIntent && input.attachmentIds.length === 0) {
      const userText = input.message.trim();
      const assistantText = serviceConnectAssistantMessage(serviceConnectIntent);

      const { error: connectIntentError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: userText,
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (connectIntentError) throw connectIntentError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model: "service-connect-intent",
          routeReason:
            "CoOperative detected a provider setup request and opened a secure credential flow without sending the credential through chat.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      input.attachmentIds.length === 0 &&
      asksAboutRecentFailure(input.message)
    ) {
      const [{ data: recentMedia }, { data: recentRecovery }] = await Promise.all([
        admin
          .from("media_generation_jobs")
          .select(
            "id,status,kind,provider,model,error,started_at,deadline_at,completed_at,created_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("recovery_incidents")
          .select(
            "id,status,error_class,error_excerpt,current_message,resolution_summary,created_at,resolved_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (recentMedia || recentRecovery) {
        const now = Date.now();
        const deadline = recentMedia?.deadline_at
          ? Date.parse(recentMedia.deadline_at)
          : Number.NaN;
        const pastDeadline =
          recentMedia?.status === "running" &&
          Number.isFinite(deadline) &&
          now > deadline;
        const rawFailure =
          conciseFailureDetail(recentMedia?.error) ||
          conciseFailureDetail(recentRecovery?.resolution_summary) ||
          conciseFailureDetail(recentRecovery?.error_excerpt);

        let assistantText: string;
        if (recentMedia?.status === "running" && !pastDeadline) {
          assistantText =
            `The media generator has not reported a confirmed failure. ${recentMedia.model || "The selected media model"} successfully started through ${recentMedia.provider || "the configured provider"}, and the job is still marked running. The “Load failed” message came from the browser/status request losing its connection while it was checking the job. I’m treating that as a transport/status-poll interruption rather than a generation failure.`;
        } else if (pastDeadline) {
          assistantText =
            `The first problem was the status connection, not a confirmed image-model failure. ${recentMedia?.model || "The selected media model"} successfully started, but the browser stopped receiving status updates and the job was left marked running past its execution deadline. That means this attempt now needs reconciliation before CoOperative can say whether the provider produced a usable result. This is a job-tracking/recovery problem, not evidence by itself that the image model failed.`;
        } else if (recentMedia?.status === "failed") {
          assistantText =
            rawFailure
              ? `The latest media route did fail. The recorded cause was: ${rawFailure}`
              : "The latest media route is recorded as failed, but it did not preserve a useful failure detail.";
        } else if (recentRecovery?.status === "completed" && recentRecovery.resolution_summary) {
          assistantText = `Recovery Agent found the cause: ${recentRecovery.resolution_summary}`;
        } else {
          assistantText =
            rawFailure
              ? `The latest recorded failure detail is: ${rawFailure}`
              : "CoOperative has a recent recovery incident, but there is not enough recorded detail yet to state the cause confidently.";
        }

        const { error: failureMessageError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (failureMessageError) throw failureMessageError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: "text",
            conversationId,
            conversationTitle,
            text: assistantText,
            provider: "code",
            model: "operational-failure-state",
            routeReason:
              "CoOperative answered from persisted job/recovery state instead of waiting for an AI model.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    if (
      input.attachmentIds.length === 0 &&
      asksToRetryRecentMedia(input.message)
    ) {
      const { data: recentMedia, error: recentMediaError } = await admin
        .from("media_generation_jobs")
        .select(
          "id,status,conversation_id,kind,prompt,provider,model,model_mixer,request_max_spend_microusd,media_level,estimated_provider_cost_microusd,pricing_source,result_url,error,started_at,deadline_at,completed_at,created_at",
        )
        .eq("owner_ref", ownerRef)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentMediaError) throw recentMediaError;

      if (recentMedia) {
        const now = Date.now();
        const deadline = recentMedia.deadline_at
          ? Date.parse(recentMedia.deadline_at)
          : Number.NaN;
        const stillActive =
          recentMedia.status === "running" &&
          Number.isFinite(deadline) &&
          now <= deadline;

        if (stillActive) {
          const assistantText =
            "That media job is still within its execution window, so I’m not starting a duplicate. I’ll keep reconnecting to the existing job instead.";

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              jobId: recentMedia.id,
              status: "running",
              execution: "media",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative prevented a duplicate media generation while the previous job is still active.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (recentMedia.status === "completed" && recentMedia.result_url) {
          const assistantText =
            "The last media job already completed, so I didn’t start another copy. Its result should be available in this conversation.";
          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              mediaUrl: recentMedia.result_url,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative prevented a duplicate retry because the previous media job already completed.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (
          recentMedia.kind === "image" &&
          providerCreditBoundary(recentMedia.error)
        ) {
          const localJobId = crypto.randomUUID();
          const { error: localJobError } = await admin
            .from("inference_jobs")
            .insert({
              id: localJobId,
              kind: "image",
              status: "queued",
              client_owner_ref: ownerRef,
              prompt: recentMedia.prompt,
              aspect_ratio: aspectRatioFromPrompt(recentMedia.prompt),
              profile: "quality",
              variation_mode: "balanced",
              seed:
                Number.parseInt(localJobId.replaceAll("-", "").slice(0, 8), 16) %
                2147483648,
            });
          if (localJobError) throw localJobError;

          const { error: localRetryMessageError } = await admin
            .from("local_ai_messages")
            .insert({
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: localJobId,
            });
          if (localRetryMessageError) throw localRetryMessageError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              jobId: localJobId,
              status: "queued",
              execution: "media",
              capability: "image",
              conversationId,
              conversationTitle,
              provider: "cooperative-local",
              model: "local-image-quality",
              routeReason:
                "OpenRouter refused the cloud generation because the provider account has no credits. CoOperative preserved the spending boundary and rerouted the image to owned local quality generation at no provider charge.",
              estimatedProviderCostUsd: 0,
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        }

        const estimatedMicrousd = Number(
          recentMedia.estimated_provider_cost_microusd || 0,
        );
        if (estimatedMicrousd > 0) {
          const estimatedUsd = estimatedMicrousd / 1_000_000;
          const assistantText =
            `The last media attempt is no longer active, but retrying it could create another paid generation charge of about ${estimatedUsd.toFixed(2)}. I won’t duplicate that spend automatically. Approve another paid generation if you want me to retry it.`;

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: "code",
              model: "media-retry-spend-gate",
              routeReason:
                "CoOperative blocked an automatic media retry because it could create a second paid generation charge.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        const stale =
          recentMedia.status === "running" &&
          (!Number.isFinite(deadline) || now > deadline);
        if (stale) {
          const staleAt = new Date().toISOString();
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              error:
                "Previous media job passed its execution deadline without a reconciled result after status polling disconnected.",
              completed_at: staleAt,
              updated_at: staleAt,
            })
            .eq("id", recentMedia.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running");
        }

        const [openRouterService, nousRuntimeAuth] = await Promise.all([
          recentMedia.provider === "openrouter"
            ? businessOwnedServiceCredentialForOwner(
                ownerRef,
                "openrouter-api",
              )
            : Promise.resolve(null),
          freshNousRuntimeAuthForOwner(ownerRef).catch(() => null),
        ]);
        const providerCredential =
          openRouterService?.credential ||
          process.env.OPENROUTER_API_KEY?.trim() ||
          undefined;

        if (recentMedia.provider === "openrouter" && !providerCredential) {
          throw new Error(
            "OpenRouter credential is unavailable for the media retry.",
          );
        }

        const retryJobId = crypto.randomUUID();
        const { error: retryInsertError } = await admin
          .from("media_generation_jobs")
          .insert({
            id: retryJobId,
            status: "queued",
            owner_ref: ownerRef,
            conversation_id: conversationId,
            kind: recentMedia.kind,
            prompt: recentMedia.prompt,
            provider: recentMedia.provider,
            model: recentMedia.model,
            model_mixer: recentMedia.model_mixer || null,
            request_max_spend_microusd:
              recentMedia.request_max_spend_microusd ?? null,
            media_level: recentMedia.media_level ?? 0,
            estimated_provider_cost_microusd: 0,
            pricing_source: recentMedia.pricing_source || "recovery-retry",
          });
        if (retryInsertError) throw retryInsertError;

        const { error: retryUserMessageError } = await admin
          .from("local_ai_messages")
          .insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          });
        if (retryUserMessageError) throw retryUserMessageError;

        try {
          const started = await startHermesMediaTask({
            jobId: retryJobId,
            kind: recentMedia.kind,
            userRequest: recentMedia.prompt,
            provider: recentMedia.provider,
            model: recentMedia.model,
            providerCredential,
            nousAuthJson: nousRuntimeAuth?.sandboxAuthJson,
          });

          const { error: retryStartError } = await admin
            .from("media_generation_jobs")
            .update({
              status: "running",
              sandbox_name: started.sandboxName,
              started_at: started.startedAt,
              deadline_at: started.deadlineAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", retryJobId)
            .eq("owner_ref", ownerRef);
          if (retryStartError) throw retryStartError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              jobId: retryJobId,
              status: "running",
              execution: "media",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative closed the stale zero-cost media attempt and restarted the same generation once through the repaired Hermes route.",
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        } catch (retryFailure) {
          const detail =
            retryFailure instanceof Error
              ? retryFailure.message
              : "Hermes media retry could not start.";
          const failedAt = new Date().toISOString();
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              error: detail.slice(0, 1200),
              completed_at: failedAt,
              updated_at: failedAt,
            })
            .eq("id", retryJobId)
            .eq("owner_ref", ownerRef);

          const recovery = await startRecoveryForJob(ownerRef, retryJobId);
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text:
                recovery.current_message ||
                "The retry still could not start, so Recovery Agent is repairing the route in the background.",
              provider: "recovery",
              model: "local-first-recovery",
              routeReason:
                "The stale media attempt was closed, but the replacement cloud route also failed to start and was handed to Recovery Agent.",
              recoveryIncidentId: recovery.id,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
    }

    const mediaPlan = planMediaRequest(input.message);
    if (mediaPlan) {
      const visibleUserText = input.message.trim();

      if (mediaPlan.clarification) {
        const { error: clarificationError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: input.attachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: mediaPlan.clarification,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (clarificationError) throw clarificationError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: mediaPlan.clarification,
            provider: "code",
            model: "media-preflight",
            routeReason:
              "CoOperative requested missing media controls before any generation spend.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (input.attachmentIds.length > 0) {
        const message =
          "Text-to-media generation is ready. Image-to-video/reference-image generation is the next media slice, so remove the attachment for this first smoke test or describe the desired scene in text.";
        const { error: unsupportedError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: input.attachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (unsupportedError) throw unsupportedError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-preflight",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const mediaLevel = Math.min(
        4,
        Math.max(0, input.modelMixer?.agents.media ?? 0),
      ) as 0 | 1 | 2 | 3 | 4;
      const requestCapUsd =
        input.modelMixer?.maxSpendUsd ?? DEFAULT_TEST_SPEND_USD;

      const [openRouterService, nousRuntimeAuth] = await Promise.all([
        businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api"),
        freshNousRuntimeAuthForOwner(ownerRef).catch(() => null),
      ]);
      const openRouterCredential =
        openRouterService?.credential ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        undefined;

      let selectedProvider = "";
      let selectedModel = "";
      let estimatedProviderCostUsd: number | null = null;
      let pricingSource = "configured-fallback";

      if (nousRuntimeAuth) {
        const nousChoice = nousManagedMediaChoice(
          mediaPlan.kind,
          mediaLevel,
          requestCapUsd,
          mediaPlan.durationSeconds,
        );
        if (nousChoice) {
          selectedProvider = "nous";
          selectedModel = nousChoice.model;
          estimatedProviderCostUsd = nousChoice.estimatedCostUsd;
          pricingSource = nousChoice.pricingSource;
        }
      }

      if (!selectedProvider) {
        try {
          const catalog = await openRouterMediaCatalog();
          const pool =
            mediaPlan.kind === "video" ? catalog.video : catalog.image;
          const affordable = affordableOpenRouterModel(
            pool,
            mediaLevel,
            {
              durationSeconds: mediaPlan.durationSeconds,
              aspectRatio: mediaPlan.aspectRatio,
            },
            requestCapUsd,
          );

          if (affordable) {
            selectedProvider = "openrouter";
            selectedModel = affordable.model.id;
            estimatedProviderCostUsd = affordable.estimatedCostUsd;
            pricingSource = catalog.source;
          }
        } catch {
          // Live OpenRouter catalog can be temporarily unavailable; configured free fallback remains eligible.
        }
      }

      if (!selectedProvider) {
        const fallbackConfig = hermesMediaConfiguration(mediaPlan.kind);
        if (fallbackConfig.freeRoute && openRouterCredential) {
          selectedProvider = fallbackConfig.provider;
          selectedModel = fallbackConfig.model;
          estimatedProviderCostUsd = 0;
          pricingSource = "configured-free-fallback";
        }
      }

      if (!selectedProvider) {
        const message = mediaBudgetSuggestion(
          mediaPlan.kind,
          requestCapUsd,
          null,
        );
        const { error: capError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content:
                message +
                "\n\nSuggested follow-ups: lower Media quality, use local/free only, or increase this request's spend cap.",
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (capError) throw capError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text:
              message +
              "\n\nSuggested follow-ups: lower Media quality, use local/free only, or increase this request's spend cap.",
            provider: "code",
            model: "media-spend-cap",
            requestMaxSpendUsd: requestCapUsd,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (
        estimatedProviderCostUsd !== null &&
        estimatedProviderCostUsd > requestCapUsd
      ) {
        const message = mediaBudgetSuggestion(
          mediaPlan.kind,
          requestCapUsd,
          estimatedProviderCostUsd,
        );
        const { error: capError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content:
                message +
                "\n\nSuggested follow-ups: lower Media quality, use local/free only, or increase the cap for this request.",
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (capError) throw capError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text:
              message +
              "\n\nSuggested follow-ups: lower Media quality, use local/free only, or increase the cap for this request.",
            provider: "code",
            model: "media-spend-cap",
            requestMaxSpendUsd: requestCapUsd,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const providerCredential =
        selectedProvider === "openrouter"
          ? openRouterCredential
          : undefined;

      if (selectedProvider === "openrouter" && !providerCredential) {
        const message =
          "OpenRouter is the next eligible backup route, but this account has no usable OpenRouter credit yet. Keep the $0.05 request cap and add provider credit, lower Media quality/use local generation, or use Nous when its managed gateway has available balance.";
        const { error: connectError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (connectError) throw connectError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-provider-funding",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const jobId = crypto.randomUUID();
      const generationPrompt = mediaPromptWithResolvedControls(
        visibleUserText,
        mediaPlan,
      );
      const requestMaxSpendMicrousd = Math.round(
        requestCapUsd * 1_000_000,
      );

      const { error: mediaJobError } = await admin
        .from("media_generation_jobs")
        .insert({
          id: jobId,
          status: "queued",
          owner_ref: ownerRef,
          conversation_id: conversationId,
          kind: mediaPlan.kind,
          prompt: generationPrompt,
          provider: selectedProvider,
          model: selectedModel,
          model_mixer: input.modelMixer || null,
          request_max_spend_microusd: requestMaxSpendMicrousd,
          media_level: mediaLevel,
          estimated_provider_cost_microusd:
            estimatedProviderCostUsd === null
              ? null
              : Math.round(estimatedProviderCostUsd * 1_000_000),
          pricing_source: pricingSource,
        });
      if (mediaJobError) throw mediaJobError;

      const { error: mediaUserMessageError } = await admin
        .from("local_ai_messages")
        .insert({
          conversation_id: conversationId,
          owner_ref: ownerRef,
          role: "user",
          content: visibleUserText,
          attachment_ids: [],
          job_id: null,
        });
      if (mediaUserMessageError) throw mediaUserMessageError;

      try {
        const started = await startHermesMediaTask({
          jobId,
          kind: mediaPlan.kind,
          userRequest: generationPrompt,
          provider: selectedProvider,
          model: selectedModel,
          providerCredential,
          nousAuthJson: nousRuntimeAuth?.sandboxAuthJson,
        });

        const { error: mediaStartError } = await admin
          .from("media_generation_jobs")
          .update({
            status: "running",
            sandbox_name: started.sandboxName,
            started_at: started.startedAt,
            deadline_at: started.deadlineAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("owner_ref", ownerRef);
        if (mediaStartError) throw mediaStartError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            jobId,
            status: "running",
            execution: "media",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            provider: started.provider,
            model: started.model,
            routeReason:
              selectedProvider === "nous"
                ? `CoOperative used the connected Nous Portal balance first for ${selectedModel}, within the ${requestCapUsd.toFixed(2)} request cap. OpenRouter remains the backup provider if Nous reports a billing/credit boundary.`
                : `CoOperative selected OpenRouter backup model ${selectedModel} within the ${requestCapUsd.toFixed(2)} request cap after checking the preferred Nous route.`,
            estimatedProviderCostUsd,
            modelMixer: input.modelMixer || null,
            requestMaxSpendUsd: requestCapUsd,
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      } catch (mediaStartFailure) {
        const detail =
          mediaStartFailure instanceof Error
            ? mediaStartFailure.message
            : "Hermes media generation could not start.";
        await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            error: detail.slice(0, 1200),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("owner_ref", ownerRef);

        try {
          const recovery = await startRecoveryForJob(ownerRef, jobId);
          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text:
                recovery.current_message ||
                "Recovery Agent is repairing the failed cloud route in the background.",
              provider: "recovery",
              model: "local-first-recovery",
              routeReason:
                "The cloud/Hermes route failed before media generation started. CoOperative handed diagnosis to local/owned Recovery Agent capacity and released the chat while repair continues.",
              recoveryIncidentId: recovery.id,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (recoveryError) {
          console.error("Could not start cloud-to-local recovery", {
            jobId,
            detail:
              recoveryError instanceof Error
                ? recoveryError.message.slice(0, 800)
                : "Unknown recovery error",
          });
          throw mediaStartFailure;
        }
      }
    }

    const directResult = await handleBusinessIntake({
      userId: owner.userId,
      businessId: input.businessId,
      conversationId,
      message: input.message,
      hasAttachments: input.attachmentIds.length > 0,
    });

    if (directResult.handled && directResult.text) {
      const { error: directMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: input.attachmentIds,
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: directResult.text,
            attachment_ids: [],
            job_id: null,
          },
        ]);

      if (directMessageError) throw directMessageError;

      const { error: directConversationError } = await admin
        .from("local_ai_conversations")
        .update({
          profile: input.profile,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      if (directConversationError) throw directConversationError;

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          profile: input.profile,
          conversationId,
          conversationTitle,
          text: directResult.text,
          provider: "code",
          model: directResult.agent || "deterministic",
          routeReason: directResult.routeReason,
          savedFacts: directResult.savedFacts || [],
          business: businessContext?.business ?? null,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: previousMessages, error: historyError } = await admin
      .from("local_ai_messages")
      .select("role,content,attachment_ids")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(39);

    if (historyError) throw historyError;

    if (currentAttachmentIds.length === 0) {
      const latestImageMessage = (previousMessages || []).find(
        (message) =>
          Array.isArray(message.attachment_ids) && message.attachment_ids.length > 0,
      );
      if (latestImageMessage) {
        currentAttachmentIds = latestImageMessage.attachment_ids.slice(0, 4);
      }
    }

    const requestedCapability = currentAttachmentIds.length > 0 ? "vision" : "text";
    let preferredNodeId: string | null = null;
    let targetNodeId: string | null = null;
    let nodeRouteNote = "";

    if (input.nodeRouting !== "default") {
      if (requestedCapability !== "text") {
        if (input.nodeRouting === "require-node") {
          return NextResponse.json(
            { error: "The selected Unison node route does not support image-understanding chat yet." },
            { status: 409 },
          );
        }
      } else {
        const authorizedNodeIds = await activeNodeIds(admin, owner.userId);
        const { data: ownedNodes, error: nodesError } =
          authorizedNodeIds.length > 0
            ? await admin
                .from("unison_nodes")
                .select("id,display_name,state,capabilities,policy,last_seen_at")
                .in("id", authorizedNodeIds)
                .order("last_seen_at", { ascending: false })
            : { data: [], error: null };

        if (nodesError) throw nodesError;

        const freshAfter = Date.now() - 90_000;
        const textNodes = (ownedNodes || []).filter((node) => {
          const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
          const policy =
            node.policy && typeof node.policy === "object"
              ? (node.policy as { allowText?: unknown })
              : {};
          const seenAt = Date.parse(node.last_seen_at || "");
          return (
            capabilities.includes("text_generation") &&
            policy.allowText !== false &&
            Number.isFinite(seenAt) &&
            seenAt >= freshAfter &&
            node.state !== "paused"
          );
        });

        if (input.nodeRouting === "require-node") {
          if (!input.requiredNodeId) {
            return NextResponse.json(
              { error: "Choose an authorized Unison node to require." },
              { status: 400 },
            );
          }

          const selected = textNodes.find((node) => node.id === input.requiredNodeId);
          if (!selected) {
            return NextResponse.json(
              { error: "That authorized Unison node is not currently available for text generation." },
              { status: 409 },
            );
          }

          targetNodeId = selected.id;
          nodeRouteNote = ` Required authorized node ${selected.display_name || selected.id}.`;
        } else {
          const statePriority: Record<string, number> = { idle: 0, online: 1, busy: 2 };
          const selected = [...textNodes].sort(
            (a, b) => (statePriority[a.state] ?? 9) - (statePriority[b.state] ?? 9),
          )[0];
          if (selected) {
            preferredNodeId = selected.id;
            nodeRouteNote =
              ` Preferred authorized node ${selected.display_name || selected.id} for the first 15 seconds.`;
          } else {
            nodeRouteNote = " No fresh owned text node was available, so normal local routing remains eligible.";
          }
        }
      }
    }


    const history = [...(previousMessages || [])]
      .reverse()
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content as string,
      }));

    const visibleUserText = input.message.trim();
    const modelUserText =
      visibleUserText ||
      (currentAttachmentIds.length > 0
        ? "Describe and analyze the attached image."
        : "");
    const systemMessages = [
      {
        role: "system" as const,
        content: COOPERATIVE_BUSINESS_CHAT_POLICY,
      },
      ...(businessContext
        ? [
            {
              role: "system" as const,
              content: businessContext.systemContext,
            },
          ]
        : []),
    ];
    const userMessage = { role: "user" as const, content: modelUserText };
    const historyLimit = 39 - systemMessages.length;
    const jobMessages = [
      ...systemMessages,
      ...history.slice(-historyLimit),
      userMessage,
    ];
    const jobId = crypto.randomUUID();
    const mixerRouteNote = input.modelMixer
      ? ` Model Mixer ${input.modelMixer.preset}; max request spend ${input.modelMixer.maxSpendUsd.toFixed(2)}; levels research=${input.modelMixer.agents.research}, planner=${input.modelMixer.agents.planner}, builder=${input.modelMixer.agents.builder}, verifier=${input.modelMixer.agents.verifier}, media=${input.modelMixer.agents.media}.`
      : "";
    const requestMaxSpendMicrousd = input.modelMixer
      ? Math.round(input.modelMixer.maxSpendUsd * 1_000_000)
      : null;

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: ownerRef,
      conversation_id: conversationId,
      messages: jobMessages,
      attachment_ids: currentAttachmentIds,
      capability: currentAttachmentIds.length > 0 ? "vision" : "text",
      profile: input.profile,
      routing_preference: input.nodeRouting,
      preferred_node_id: preferredNodeId,
      target_node_id: targetNodeId,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.profile === "quality" ? "local-quality" : "local-fast",
      task_class: "general",
      route_reason:
        input.profile === "quality"
          ? `Manual Local Quality selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}${nodeRouteNote}${mixerRouteNote}`
          : `Manual Local Fast selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}${nodeRouteNote}${mixerRouteNote}`,
      allow_paid_fallback:
        requestedCapability === "text" &&
        input.nodeRouting !== "require-node" &&
        profileBalance.funded,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      model_mixer: input.modelMixer || null,
      request_max_spend_microusd: requestMaxSpendMicrousd,
    });

    if (jobError) throw jobError;

    const { error: messageError } = await admin.from("local_ai_messages").insert({
      conversation_id: conversationId,
      owner_ref: ownerRef,
      role: "user",
      content: visibleUserText,
      attachment_ids: input.attachmentIds,
      job_id: jobId,
    });

    if (messageError) {
      await admin.from("text_inference_jobs").delete().eq("id", jobId);
      throw messageError;
    }

    const { error: updateConversationError } = await admin
      .from("local_ai_conversations")
      .update({
        profile: input.profile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("owner_ref", ownerRef);

    if (updateConversationError) throw updateConversationError;

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        profile: input.profile,
        conversationId,
        conversationTitle,
        business: businessContext?.business ?? null,
        routingPreference: input.nodeRouting,
        preferredNodeId,
        targetNodeId,
        paidAiEligible:
          requestedCapability === "text" &&
          input.nodeRouting !== "require-node" &&
          profileBalance.funded,
        availableAiBalanceUsd: profileBalance.availableUsd,
        modelMixer: input.modelMixer || null,
        requestMaxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not queue local AI chat.";
    return NextResponse.json(
      { error: "Could not queue local AI chat.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = owner.ownerRef;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";

  try {
    const admin = createAdminSupabaseClient();
    let query = admin
      .from("text_inference_jobs")
      .select(
        "id,status,profile,conversation_id,capability,attachment_ids,messages,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,worker_id,routing_preference,preferred_node_id,target_node_id,route_reason,allow_paid_fallback,error,created_at,completed_at",
      )
      .eq("client_owner_ref", ownerRef);

    query = jobId
      ? query.eq("id", jobId)
      : query
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1);

    const { data: job, error } = await query.maybeSingle();

    if (error) throw error;
    if (!job) {
      let mediaQuery = admin
        .from("media_generation_jobs")
        .select(
          "id,status,conversation_id,kind,prompt,provider,model,model_mixer,request_max_spend_microusd,media_level,estimated_provider_cost_microusd,pricing_source,fallback_from_job_id,sandbox_name,result_url,result_text,usage,error,started_at,deadline_at,completed_at,created_at",
        )
        .eq("owner_ref", ownerRef);

      mediaQuery = jobId
        ? mediaQuery.eq("id", jobId)
        : mediaQuery
            .in("status", ["queued", "running"])
            .order("created_at", { ascending: false })
            .limit(1);

      const { data: mediaJob, error: mediaError } = await mediaQuery.maybeSingle();
      if (mediaError) throw mediaError;

      if (!mediaJob) {
        let localImageQuery = admin
          .from("inference_jobs")
          .select(
            "id,status,prompt,aspect_ratio,profile,result_path,result_model,result_provider,worker_id,error,created_at,completed_at",
          )
          .eq("client_owner_ref", ownerRef);

        localImageQuery = jobId
          ? localImageQuery.eq("id", jobId)
          : localImageQuery
              .in("status", ["queued", "running"])
              .order("created_at", { ascending: false })
              .limit(1);

        const { data: localImageJob, error: localImageError } =
          await localImageQuery.maybeSingle();
        if (localImageError) throw localImageError;

        if (!localImageJob) {
          return jobId
            ? NextResponse.json({ error: "Job not found." }, { status: 404 })
            : new Response(null, { status: 204 });
        }

        const { data: localImageMessage } = await admin
          .from("local_ai_messages")
          .select("conversation_id")
          .eq("owner_ref", ownerRef)
          .eq("job_id", localImageJob.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const conversationId = localImageMessage?.conversation_id || null;

        let mediaUrl: string | null = null;
        if (localImageJob.status === "completed" && localImageJob.result_path) {
          const { data: signed, error: signError } = await admin.storage
            .from("inference-job-assets")
            .createSignedUrl(localImageJob.result_path, 15 * 60);
          if (signError) throw signError;
          mediaUrl = signed?.signedUrl || null;
        }

        if (localImageJob.status === "completed" && mediaUrl) {
          const resultText =
            `Generated image locally with ${localImageJob.result_model || "CoOperative local image model"}.\nMEDIA_IMAGE:${mediaUrl}`;

          const { data: existingResultMessage } = await admin
            .from("local_ai_messages")
            .select("id")
            .eq("conversation_id", conversationId)
            .eq("owner_ref", ownerRef)
            .eq("content", resultText)
            .limit(1)
            .maybeSingle();

          if (!existingResultMessage) {
            await admin.from("local_ai_messages").insert({
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: resultText,
              attachment_ids: [],
              job_id: null,
            });
          }
        }

        return NextResponse.json(
          {
            jobId: localImageJob.id,
            execution: "media",
            status: localImageJob.status,
            conversationId,
            capability: "image",
            provider: localImageJob.result_provider || "cooperative-local",
            model: localImageJob.result_model || "local-image-quality",
            text:
              localImageJob.status === "completed" && mediaUrl
                ? `Generated image locally with ${localImageJob.result_model || "CoOperative local image model"}.\nMEDIA_IMAGE:${mediaUrl}`
                : null,
            mediaUrl,
            workerId: localImageJob.worker_id,
            error: localImageJob.error,
            routeReason:
              localImageJob.status === "completed"
                ? "Owned local image generation completed after the cloud provider hit an account-credit boundary."
                : "Owned local image generation is handling the request without increasing provider spend.",
            createdAt: localImageJob.created_at,
            completedAt: localImageJob.completed_at,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (
        mediaJob.status === "running" &&
        mediaJob.sandbox_name &&
        mediaJob.deadline_at
      ) {
        const polled = await pollHermesMediaTask({
          sandboxName: mediaJob.sandbox_name,
          deadlineAt: mediaJob.deadline_at,
        });

        if (polled.state === "running") {
          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "running",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: mediaJob.provider,
              model: mediaJob.model,
              routeReason: "Hermes media generation is still running in Vercel Sandbox.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        if (polled.state === "completed" && polled.mediaUrl) {
          const marker =
            mediaJob.kind === "video" ? "MEDIA_VIDEO:" : "MEDIA_IMAGE:";
          const resultText =
            `Generated ${mediaJob.kind} with ${mediaJob.model}.\n${marker}${polled.mediaUrl}`;
          const completedAt = new Date().toISOString();

          const { data: claimed, error: claimError } = await admin
            .from("media_generation_jobs")
            .update({
              status: "completed",
              result_url: polled.mediaUrl,
              result_text: resultText,
              usage: polled.usage,
              error: null,
              completed_at: completedAt,
              updated_at: completedAt,
            })
            .eq("id", mediaJob.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running")
            .select("id")
            .maybeSingle();
          if (claimError) throw claimError;

          if (claimed && mediaJob.conversation_id) {
            const { error: resultMessageError } = await admin
              .from("local_ai_messages")
              .insert({
                conversation_id: mediaJob.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: resultText,
                attachment_ids: [],
                job_id: null,
              });
            if (resultMessageError) throw resultMessageError;

            await admin
              .from("local_ai_conversations")
              .update({ updated_at: completedAt })
              .eq("id", mediaJob.conversation_id)
              .eq("owner_ref", ownerRef);
          }

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: mediaJob.provider,
              model: mediaJob.model,
              text: resultText,
              mediaUrl: polled.mediaUrl,
              routeReason:
                "Cheap/free Hermes orchestration completed one configured media generation call.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const failure = polled.error || "Hermes media generation failed.";
        const completedAt = new Date().toISOString();
        const { data: claimedFailure, error: failureUpdateError } = await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            usage: polled.usage,
            error: failure.slice(0, 1200),
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", mediaJob.id)
          .eq("owner_ref", ownerRef)
          .eq("status", "running")
          .select("id")
          .maybeSingle();
        if (failureUpdateError) throw failureUpdateError;

        if (
          claimedFailure &&
          mediaJob.provider === "nous" &&
          providerCreditBoundary(failure)
        ) {
          const openRouterService =
            await businessOwnedServiceCredentialForOwner(
              ownerRef,
              "openrouter-api",
            );
          const openRouterCredential =
            openRouterService?.credential ||
            process.env.OPENROUTER_API_KEY?.trim() ||
            undefined;
          const requestCapUsd =
            typeof mediaJob.request_max_spend_microusd === "number"
              ? mediaJob.request_max_spend_microusd / 1_000_000
              : DEFAULT_TEST_SPEND_USD;

          if (openRouterCredential) {
            try {
              const catalog = await openRouterMediaCatalog(true);
              const pool =
                mediaJob.kind === "video" ? catalog.video : catalog.image;
              const affordable = affordableOpenRouterModel(
                pool,
                Math.min(
                  4,
                  Math.max(0, Number(mediaJob.media_level ?? 0)),
                ) as 0 | 1 | 2 | 3 | 4,
                {
                  durationSeconds:
                    mediaJob.kind === "video"
                      ? Number(
                          mediaJob.prompt.match(/\b(\d{1,2})\s*(?:second|seconds|sec|secs|s)\b/i)?.[1] ||
                            5,
                        )
                      : null,
                  aspectRatio: aspectRatioFromPrompt(mediaJob.prompt),
                },
                requestCapUsd,
              );

              if (affordable) {
                const fallbackJobId = crypto.randomUUID();
                const { error: fallbackInsertError } = await admin
                  .from("media_generation_jobs")
                  .insert({
                    id: fallbackJobId,
                    status: "queued",
                    owner_ref: ownerRef,
                    conversation_id: mediaJob.conversation_id,
                    kind: mediaJob.kind,
                    prompt: mediaJob.prompt,
                    provider: "openrouter",
                    model: affordable.model.id,
                    model_mixer: mediaJob.model_mixer || null,
                    request_max_spend_microusd:
                      mediaJob.request_max_spend_microusd,
                    media_level: mediaJob.media_level,
                    estimated_provider_cost_microusd: Math.round(
                      affordable.estimatedCostUsd * 1_000_000,
                    ),
                    pricing_source: catalog.source,
                    fallback_from_job_id: mediaJob.id,
                  });
                if (fallbackInsertError) throw fallbackInsertError;

                try {
                  const started = await startHermesMediaTask({
                    jobId: fallbackJobId,
                    kind: mediaJob.kind,
                    userRequest: mediaJob.prompt,
                    provider: "openrouter",
                    model: affordable.model.id,
                    providerCredential: openRouterCredential,
                    orchestratorProvider: "openrouter",
                    orchestratorModel: "openrouter/free",
                  });

                  const { error: fallbackStartUpdateError } = await admin
                    .from("media_generation_jobs")
                    .update({
                      status: "running",
                      sandbox_name: started.sandboxName,
                      started_at: started.startedAt,
                      deadline_at: started.deadlineAt,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", fallbackJobId)
                    .eq("owner_ref", ownerRef);
                  if (fallbackStartUpdateError) {
                    throw fallbackStartUpdateError;
                  }

                  return NextResponse.json(
                    {
                      jobId: fallbackJobId,
                      execution: "media",
                      status: "running",
                      conversationId: mediaJob.conversation_id,
                      capability: mediaJob.kind,
                      provider: "openrouter",
                      model: affordable.model.id,
                      routeReason:
                        `Nous reported a credit/billing boundary, so CoOperative automatically moved this request to the best OpenRouter backup that fits the ${requestCapUsd.toFixed(2)} cap.`,
                      estimatedProviderCostUsd:
                        affordable.estimatedCostUsd,
                    },
                    { headers: { "Cache-Control": "no-store" } },
                  );
                } catch (fallbackStartFailure) {
                  const fallbackError =
                    fallbackStartFailure instanceof Error
                      ? fallbackStartFailure.message
                      : "OpenRouter backup could not start.";
                  await admin
                    .from("media_generation_jobs")
                    .update({
                      status: "failed",
                      error: fallbackError.slice(0, 1200),
                      completed_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", fallbackJobId)
                    .eq("owner_ref", ownerRef);
                }
              }
            } catch (fallbackPlanningError) {
              console.error("Could not plan OpenRouter media fallback", {
                jobId: mediaJob.id,
                detail:
                  fallbackPlanningError instanceof Error
                    ? fallbackPlanningError.message.slice(0, 800)
                    : "Unknown fallback planning error",
              });
            }
          }
        }

        if (claimedFailure && providerCreditBoundary(failure)) {
          const requestCapUsd =
            typeof mediaJob.request_max_spend_microusd === "number"
              ? mediaJob.request_max_spend_microusd / 1_000_000
              : DEFAULT_TEST_SPEND_USD;
          const providerName =
            mediaJob.provider === "nous" ? "Nous" : "OpenRouter";
          const suggestion =
            mediaBudgetSuggestion(mediaJob.kind, requestCapUsd, null);
          const resultText =
            `${providerName} reached a provider-credit boundary before this generation could continue. ${suggestion}\n\nSuggested follow-ups: lower Media quality, use local/free only, or increase the request cap after funding the backup provider.`;

          if (mediaJob.conversation_id) {
            const { error: messageError } = await admin
              .from("local_ai_messages")
              .insert({
                conversation_id: mediaJob.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: resultText,
                attachment_ids: [],
                job_id: null,
              });
            if (messageError) throw messageError;

            await admin
              .from("local_ai_conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", mediaJob.conversation_id)
              .eq("owner_ref", ownerRef);
          }

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "code",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: "code",
              model: "media-spend-boundary",
              text: resultText,
              routeReason:
                "A provider funding boundary is a spending decision, not a runtime defect, so CoOperative stopped without invoking Recovery Agent.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        return NextResponse.json(
          {
            jobId: mediaJob.id,
            execution: "media",
            status: "failed",
            conversationId: mediaJob.conversation_id,
            capability: mediaJob.kind,
            provider: mediaJob.provider,
            model: mediaJob.model,
            error: failure,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      return NextResponse.json(
        {
          jobId: mediaJob.id,
          execution: "media",
          status: mediaJob.status,
          conversationId: mediaJob.conversation_id,
          capability: mediaJob.kind,
          provider: mediaJob.provider,
          model: mediaJob.model,
          text: mediaJob.result_text,
          mediaUrl: mediaJob.result_url,
          error: mediaJob.error,
          createdAt: mediaJob.created_at,
          completedAt: mediaJob.completed_at,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        jobId: job.id,
        execution:
          job.worker_id === "cooperative-paid-router" ? "paid-ai" : undefined,
        status: job.status,
        profile: job.profile,
        conversationId: job.conversation_id,
        capability: job.capability,
        attachmentIds: job.attachment_ids,
        messages: job.messages,
        partialText: job.partial_text,
        text: job.result_text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        firstTokenMs: job.first_token_ms,
        latencyMs: job.latency_ms,
        workerId: job.worker_id,
        routingPreference: job.routing_preference || "default",
        preferredNodeId: job.preferred_node_id,
        targetNodeId: job.target_node_id,
        routeReason: job.route_reason,
        paidFallbackAllowed: job.allow_paid_fallback === true,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read local AI chat job.";
    return NextResponse.json(
      { error: "Could not read local AI chat job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
