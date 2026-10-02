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
  recommendedForLevel,
  type MediaCatalogModel,
} from "@/lib/inference/openrouter-media-catalog";

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

export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = chatRequestSchema.parse(await request.json());
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

      const mediaLevel = input.modelMixer?.agents.media ?? 0;
      let selectedMediaModel: MediaCatalogModel | null = null;
      let pricingSource = "configured-fallback";

      try {
        const catalog = await openRouterMediaCatalog();
        const pool = mediaPlan.kind === "video" ? catalog.video : catalog.image;
        const requested = recommendedForLevel(pool, mediaLevel);
        const freeFallback = pool.find((model) => model.free) || null;
        const paidMediaEnabled =
          process.env.HERMES_MEDIA_PAID_ENABLED === "true" && profileBalance.funded;

        selectedMediaModel =
          requested && (!requested.free && !paidMediaEnabled)
            ? freeFallback
            : requested || freeFallback;
        pricingSource = catalog.source;
      } catch {
        selectedMediaModel = null;
      }

      const fallbackConfig = hermesMediaConfiguration(mediaPlan.kind);
      const selectedProvider = selectedMediaModel ? "openrouter" : fallbackConfig.provider;
      const selectedModel = selectedMediaModel?.id || fallbackConfig.model;
      const selectedFree = selectedMediaModel?.free ?? fallbackConfig.freeRoute;
      const estimatedProviderCostUsd = selectedMediaModel
        ? estimatedMediaProviderCostUsd(selectedMediaModel, mediaPlan.durationSeconds)
        : selectedFree
          ? 0
          : null;

      if (!selectedFree && process.env.HERMES_MEDIA_PAID_ENABLED !== "true") {
        const message =
          "I found a paid media route, but paid media is still disabled until CoOperative's markup/margin rule is configured. Move the Media slider to Free or use the free smoke-test route for now.";
        const { error: paidGateError } = await admin
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
        if (paidGateError) throw paidGateError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-spend-gate",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const requestCapUsd = input.modelMixer?.maxSpendUsd ?? null;
      if (
        estimatedProviderCostUsd !== null &&
        requestCapUsd !== null &&
        estimatedProviderCostUsd > requestCapUsd
      ) {
        const message =
          `The live estimate for ${selectedModel} is about ${estimatedProviderCostUsd.toFixed(2)}, above this request's ${requestCapUsd.toFixed(2)} max-spend cap. Raise the cap or lower the Media slider.`;
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
              content: message,
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
            text: message,
            provider: "code",
            model: "media-spend-cap",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const jobId = crypto.randomUUID();
      const generationPrompt = mediaPromptWithResolvedControls(
        visibleUserText,
        mediaPlan,
      );
      const requestMaxSpendMicrousd = input.modelMixer
        ? Math.round(input.modelMixer.maxSpendUsd * 1_000_000)
        : null;

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
              `CoOperative selected ${selectedModel} from the ${pricingSource} media catalog at Media level ${mediaLevel}, then used a cheap/free Hermes orchestrator for one media-generation call.`,
            estimatedProviderCostUsd,
            modelMixer: input.modelMixer || null,
            requestMaxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
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
        throw mediaStartFailure;
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
          "id,status,conversation_id,kind,provider,model,sandbox_name,result_url,result_text,usage,error,started_at,deadline_at,completed_at,created_at",
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
        return jobId
          ? NextResponse.json({ error: "Job not found." }, { status: 404 })
          : new Response(null, { status: 204 });
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
        await admin
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
          .eq("status", "running");

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
