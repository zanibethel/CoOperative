import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import {
  COOPERATIVE_BUSINESS_CHAT_POLICY,
  COOPERATIVE_BUSINESS_POLICY_REVISION,
} from "@/lib/ai/business-chat-policy";
import { buildBusinessChatContext } from "@/lib/ai/business-context";

export const runtime = "nodejs";
export const maxDuration = 30;

const chatRequestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    businessId: z.string().uuid().optional(),
    message: z.string().max(16000).default(""),
    attachmentIds: z.array(z.string().uuid()).max(4).default([]),
    profile: z.enum(["fast", "quality"]).default("fast"),
    maxTokens: z.number().int().min(16).max(4096).default(768),
    temperature: z.number().min(0).max(2).default(0.2),
  })
  .refine(
    (value) => Boolean(value.message.trim()) || value.attachmentIds.length > 0,
    "Message or image attachment is required.",
  );

async function currentOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user
    ? { userId: user.id, ownerRef: `coop-user:${user.id}` }
    : null;
}

function titleFromMessage(message: string, hasImages: boolean) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return hasImages ? "Image question" : "New chat";
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
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

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: ownerRef,
      conversation_id: conversationId,
      messages: jobMessages,
      attachment_ids: currentAttachmentIds,
      capability: currentAttachmentIds.length > 0 ? "vision" : "text",
      profile: input.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.profile === "quality" ? "local-quality" : "local-fast",
      task_class: "general",
      route_reason:
        input.profile === "quality"
          ? `Manual Local Quality selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}`
          : `Manual Local Fast selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}`,
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
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
        "id,status,profile,conversation_id,capability,attachment_ids,messages,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,error,created_at,completed_at",
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
      return jobId
        ? NextResponse.json({ error: "Job not found." }, { status: 404 })
        : new Response(null, { status: 204 });
    }

    return NextResponse.json(
      {
        jobId: job.id,
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
