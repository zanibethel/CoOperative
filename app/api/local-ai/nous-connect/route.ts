import { NextResponse } from "next/server";
import { z } from "zod";

import {
  pollNousDeviceAuthorization,
  startNousDeviceAuthorization,
  storedNousAuthDocument,
} from "@/lib/integrations/nous-portal";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";

export const runtime = "nodejs";
export const maxDuration = 30;

const startSchema = z.object({
  conversationId: z.string().uuid().optional(),
});

function ownerRefFor(userId: string) {
  return `coop-user:${userId}`;
}

async function ownerOrganization(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureNousConnectedService(userId: string, organizationId: string) {
  const admin = createAdminSupabaseClient();
  const { data: existing, error: existingError } = await admin
    .from("connected_services")
    .select("id,connection_status")
    .eq("organization_id", organizationId)
    .eq("provider_key", "nous-portal")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: created, error: createError } = await admin
    .from("connected_services")
    .insert({
      organization_id: organizationId,
      provider_key: "nous-portal",
      service_name: "Nous Portal",
      external_account_label: "Hermes orchestration + managed tools",
      connection_method: "oauth",
      connection_status: "not-connected",
      monthly_cost_cents: 0,
      billing_frequency: "usage",
      features_used: [
        "Hermes model routing",
        "managed image generation",
        "managed web/search tools",
      ],
      data_available: [],
      permissions: [],
      replacement_goal: "keep",
      notes:
        "Connected conversationally through CoOperative Chat using Nous Portal device-code OAuth.",
      created_by: userId,
    })
    .select("id,connection_status")
    .single();
  if (createError) throw createError;
  return created;
}

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = startSchema.parse(await request.json().catch(() => ({})));
    const ownerRef = ownerRefFor(userId);
    const organization = await ownerOrganization(userId);
    if (!organization) {
      return NextResponse.json(
        { error: "Create a business/project profile before connecting Nous Portal." },
        { status: 409 },
      );
    }

    const admin = createAdminSupabaseClient();

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

    const service = await ensureNousConnectedService(userId, organization.id);
    if (service.connection_status === "connected") {
      return NextResponse.json(
        {
          connected: true,
          providerKey: "nous-portal",
          providerName: "Nous Portal",
          message: "Nous Portal is already connected.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const started = await startNousDeviceAuthorization();
    const expiresAt = new Date(Date.now() + started.expiresIn * 1000).toISOString();

    const { data: oauthSession, error: sessionError } = await admin
      .from("provider_oauth_sessions")
      .insert({
        owner_ref: ownerRef,
        organization_id: organization.id,
        service_id: service.id,
        provider_key: "nous-portal",
        conversation_id: input.conversationId || null,
        status: "pending",
        device_code: started.deviceCode,
        user_code: started.userCode,
        verification_url: started.verificationUrl,
        poll_interval_seconds: started.pollIntervalSeconds,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (sessionError) throw sessionError;

    return NextResponse.json(
      {
        connected: false,
        status: "pending",
        sessionId: oauthSession.id,
        providerKey: "nous-portal",
        providerName: "Nous Portal",
        userCode: started.userCode,
        verificationUrl: started.verificationUrl,
        expiresAt,
        pollIntervalSeconds: started.pollIntervalSeconds,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not start Nous Portal sign-in.";
    return NextResponse.json(
      { error: detail.slice(0, 600) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
  const ownerRef = ownerRefFor(userId);
  const admin = createAdminSupabaseClient();

  if (!sessionId) {
    const organization = await ownerOrganization(userId);
    if (!organization) {
      return NextResponse.json(
        {
          connected: false,
          providerKey: "nous-portal",
          providerName: "Nous Portal",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: service, error: serviceError } = await admin
      .from("connected_services")
      .select("id,connection_status,last_synced_at")
      .eq("organization_id", organization.id)
      .eq("provider_key", "nous-portal")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (serviceError) throw serviceError;

    return NextResponse.json(
      {
        connected: service?.connection_status === "connected",
        providerKey: "nous-portal",
        providerName: "Nous Portal",
        lastVerifiedAt: service?.last_synced_at || null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json({ error: "OAuth session is invalid." }, { status: 400 });
  }

  try {
    const { data: session, error: sessionError } = await admin
      .from("provider_oauth_sessions")
      .select(
        "id,status,service_id,conversation_id,device_code,user_code,verification_url,poll_interval_seconds,expires_at,error",
      )
      .eq("id", sessionId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) {
      return NextResponse.json({ error: "OAuth session not found." }, { status: 404 });
    }

    if (session.status === "approved") {
      return NextResponse.json(
        {
          connected: true,
          status: "approved",
          providerKey: "nous-portal",
          providerName: "Nous Portal",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (["expired", "denied", "failed", "cancelled"].includes(session.status)) {
      return NextResponse.json(
        {
          connected: false,
          status: session.status,
          error: session.error || null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (Date.now() >= Date.parse(session.expires_at)) {
      await admin
        .from("provider_oauth_sessions")
        .update({
          status: "expired",
          device_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          connected: false,
          status: "expired",
          error: "The Nous Portal sign-in code expired. Start the connection again.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!session.device_code) {
      return NextResponse.json(
        { connected: false, status: "failed", error: "OAuth device code is unavailable." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const polled = await pollNousDeviceAuthorization(session.device_code);

    if (polled.status === "pending") {
      return NextResponse.json(
        {
          connected: false,
          status: "pending",
          userCode: session.user_code,
          verificationUrl: session.verification_url,
          expiresAt: session.expires_at,
          pollIntervalSeconds:
            Number(session.poll_interval_seconds || 2) + (polled.slowDown ? 1 : 0),
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (polled.status === "denied" || polled.status === "expired") {
      const status = polled.status;
      await admin
        .from("provider_oauth_sessions")
        .update({
          status,
          device_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          connected: false,
          status,
          error:
            status === "denied"
              ? "Nous Portal authorization was declined."
              : "The Nous Portal sign-in code expired.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { error: storeError } = await admin.rpc(
      "store_connected_service_credential",
      {
        p_service_id: session.service_id,
        p_secret: storedNousAuthDocument(polled.state),
      },
    );
    if (storeError) throw storeError;

    const now = new Date().toISOString();
    const { error: serviceUpdateError } = await admin
      .from("connected_services")
      .update({
        connection_status: "connected",
        data_available: [
          "text-generation",
          "image-generation",
          "web-search",
          "text-to-speech",
          "browser-tools",
        ],
        permissions: [
          "inference:execute",
          "managed-tools:execute",
        ],
        last_synced_at: now,
        updated_at: now,
      })
      .eq("id", session.service_id);
    if (serviceUpdateError) throw serviceUpdateError;

    await admin
      .from("provider_oauth_sessions")
      .update({
        status: "approved",
        device_code: null,
        error: null,
        updated_at: now,
      })
      .eq("id", session.id)
      .eq("owner_ref", ownerRef);

    const message =
      "Nous Portal is connected. CoOperative can now prefer your Nous/Hermes model access and managed tools before OpenRouter paid routes. The long-lived refresh grant stays in the encrypted server-side vault; temporary Hermes workers receive only short-lived access state.";

    if (session.conversation_id) {
      const { error: messageError } = await admin
        .from("local_ai_messages")
        .insert({
          conversation_id: session.conversation_id,
          owner_ref: ownerRef,
          role: "assistant",
          content: message,
          attachment_ids: [],
          job_id: null,
        });
      if (messageError) throw messageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: now })
        .eq("id", session.conversation_id)
        .eq("owner_ref", ownerRef);
    }

    return NextResponse.json(
      {
        connected: true,
        status: "approved",
        providerKey: "nous-portal",
        providerName: "Nous Portal",
        message,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not complete Nous Portal sign-in.";

    await admin
      .from("provider_oauth_sessions")
      .update({
        status: "failed",
        error: detail.slice(0, 600),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("owner_ref", ownerRef);

    return NextResponse.json(
      { connected: false, status: "failed", error: detail.slice(0, 600) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
