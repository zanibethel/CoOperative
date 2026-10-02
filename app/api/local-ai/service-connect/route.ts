import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isBusinessAiProviderKey,
  validateBusinessAiCredential,
} from "@/lib/integrations/business-ai-providers";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const connectSchema = z.object({
  conversationId: z.string().uuid().optional(),
  providerKey: z.string().min(1).max(100),
  credential: z.string().min(8).max(20_000),
});

function providerDisplayName(providerKey: string) {
  if (providerKey === "openrouter-api") return "OpenRouter";
  if (providerKey === "openai-api") return "OpenAI";
  if (providerKey === "anthropic-claude") return "Claude";
  if (providerKey === "google-gemini") return "Gemini";
  return providerKey;
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = connectSchema.parse(await request.json());
    if (!isBusinessAiProviderKey(input.providerKey)) {
      return NextResponse.json(
        { error: "That provider is not available for secure chat connection yet." },
        { status: 409 },
      );
    }

    const ownerRef = `coop-user:${userId}`;
    const admin = createAdminSupabaseClient();

    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("id")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization) {
      return NextResponse.json(
        { error: "Create a business/project profile before connecting provider credentials." },
        { status: 409 },
      );
    }

    if (input.conversationId) {
      const { data: conversation, error: conversationError } = await admin
        .from("local_ai_conversations")
        .select("id")
        .eq("id", input.conversationId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
    }

    const check = await validateBusinessAiCredential(
      input.providerKey,
      input.credential,
    );

    const { data: provider, error: providerError } = await admin
      .from("service_providers")
      .select("provider_key,name,connection_method")
      .eq("provider_key", input.providerKey)
      .maybeSingle();
    if (providerError) throw providerError;
    if (!provider || provider.connection_method !== "api") {
      return NextResponse.json(
        { error: "That provider is not configured for secure API connection." },
        { status: 409 },
      );
    }

    const { data: existingService, error: existingError } = await admin
      .from("connected_services")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("provider_key", input.providerKey)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    let serviceId = existingService?.id || null;
    if (!serviceId) {
      const { data: created, error: createError } = await admin
        .from("connected_services")
        .insert({
          organization_id: organization.id,
          provider_key: input.providerKey,
          service_name: provider.name,
          external_account_label: "Hermes execution gateway",
          connection_method: "api",
          connection_status: "not-connected",
          monthly_cost_cents: 0,
          billing_frequency: "usage",
          features_used:
            input.providerKey === "openrouter-api"
              ? ["Hermes routing", "image generation", "video generation"]
              : ["AI inference"],
          replacement_goal: "keep",
          notes:
            "Connected conversationally through CoOperative Chat. Credential is stored in the server-side vault.",
          created_by: userId,
        })
        .select("id")
        .single();

      if (createError) throw createError;
      serviceId = created.id;
    }

    const { error: storeError } = await admin.rpc(
      "store_connected_service_credential",
      {
        p_service_id: serviceId,
        p_secret: input.credential.trim(),
      },
    );
    if (storeError) {
      console.error("Could not store conversational service credential", {
        serviceId,
        providerKey: input.providerKey,
        detail: storeError.message.slice(0, 500),
      });
      return NextResponse.json(
        { error: "The credential was verified but could not be stored securely." },
        { status: 502 },
      );
    }

    const modelTags = check.models.slice(0, 20).map((model) => `model:${model}`);
    const mediaCapabilities =
      input.providerKey === "openrouter-api"
        ? ["image-generation", "video-generation"]
        : [];

    const { error: updateError } = await admin
      .from("connected_services")
      .update({
        connection_status: "connected",
        data_available: [
          "text-generation",
          ...mediaCapabilities,
          ...modelTags,
        ],
        permissions:
          input.providerKey === "openrouter-api"
            ? ["inference:execute", "media:generate"]
            : ["inference:execute"],
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", serviceId)
      .eq("organization_id", organization.id);
    if (updateError) throw updateError;

    const providerName = providerDisplayName(input.providerKey);
    const message =
      input.providerKey === "openrouter-api"
        ? "OpenRouter is connected securely. Hermes can now use approved OpenRouter image/video routes. Paid media is still governed by your Model Mixer, profile balance, and spending cap. We can run a free generation test now."
        : `${providerName} is connected securely and ready for approved CoOperative jobs.`;

    if (input.conversationId) {
      const { error: messageError } = await admin
        .from("local_ai_messages")
        .insert({
          conversation_id: input.conversationId,
          owner_ref: ownerRef,
          role: "assistant",
          content: message,
          attachment_ids: [],
          job_id: null,
        });
      if (messageError) throw messageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.conversationId)
        .eq("owner_ref", ownerRef);
    }

    return NextResponse.json(
      {
        ok: true,
        connected: true,
        providerKey: input.providerKey,
        providerName,
        serviceId,
        availableModels: check.models.slice(0, 20),
        message,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not connect this provider.";
    return NextResponse.json(
      { error: detail.slice(0, 500) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
