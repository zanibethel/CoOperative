import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  oauthAuthorizationUrl,
  oauthPublicOrigin,
  oauthProviderCredentials,
  userOAuthProvider,
} from "@/lib/integrations/user-oauth-providers";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
});

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: object, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authenticatedOrigin(request: Request): boolean {
  try {
    return request.headers.get("origin") === oauthPublicOrigin();
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const admin = createAdminSupabaseClient();
  const sessionId = params.get("sessionId");
  if (sessionId) {
    if (!z.string().uuid().safeParse(sessionId).success) {
      return json({ error: "Invalid OAuth session." }, 400);
    }
    const { data, error } = await admin.from("user_oauth_flows")
      .select("id,status,expires_at")
      .eq("id", sessionId).eq("user_id", userId).maybeSingle();
    if (error) return json({ error: "Could not check connection." }, 502);
    if (!data) return json({ error: "Session not found." }, 404);
    const expired = data.status === "pending" &&
      new Date(data.expires_at).getTime() <= Date.now();
    return json({
      connected: data.status === "approved",
      status: expired ? "expired" : data.status,
    });
  }

  const providerKey = params.get("providerKey") || "";
  if (!userOAuthProvider(providerKey)) return json({ error: "Unknown provider." }, 400);
  const { data, error } = await admin.from("user_oauth_connections")
    .select("id,provider_key,account_label,granted_scopes,connection_status,expires_at,last_verified_at")
    .eq("user_id", userId).eq("provider_key", providerKey)
    .order("updated_at", { ascending: false });
  if (error) return json({ error: "Could not read connections." }, 502);
  const accounts = data || [];
  return json({
    connected: accounts.some((account) => account.connection_status === "connected"),
    providerKey,
    accounts,
  });
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (!authenticatedOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Expected JSON request." }, 415);
  }
  const providerKey = new URL(request.url).searchParams.get("providerKey") || "";
  const provider = userOAuthProvider(providerKey);
  if (!provider) return json({ error: "This provider is not yet configured." }, 409);

  try {
    oauthProviderCredentials(provider);
    const input = requestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    if (input.conversationId) {
      const { data: conversation, error } = await admin
        .from("local_ai_conversations").select("id")
        .eq("id", input.conversationId)
        .eq("owner_ref", "coop-user:" + userId).maybeSingle();
      if (error || !conversation) return json({ error: "Conversation not found." }, 404);
    }

    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: pending, error: pendingError } = await admin.from("user_oauth_flows")
      .select("id").eq("user_id", userId).eq("status", "pending")
      .gte("created_at", recent).limit(7);
    if (pendingError) throw new Error("Could not start authorization.");
    if ((pending || []).length >= 6) {
      return json({ error: "Too many recent sign-in attempts. Try again shortly." }, 429);
    }

    const state = randomBytes(32).toString("base64url");
    const verifier = provider.pkce ? randomBytes(48).toString("base64url") : null;
    const challenge = verifier
      ? createHash("sha256").update(verifier).digest("base64url")
      : undefined;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: flow, error } = await admin.from("user_oauth_flows")
      .insert({
        user_id: userId,
        provider_key: provider.key,
        state_hash: digest(state),
        pkce_verifier: verifier,
        expires_at: expiresAt,
        status: "pending",
      })
      .select("id").single();
    if (error || !flow) throw new Error("Could not create authorization session.");

    return json({
      connected: false,
      sessionId: flow.id,
      verificationUrl: oauthAuthorizationUrl(provider, state, challenge),
      pollIntervalSeconds: 2,
      expiresAt,
      providerKey: provider.key,
      providerName: provider.name,
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start sign-in.";
    return json({ error: message.startsWith("COOP_") || message.includes("not configured")
      ? message : "Could not start secure sign-in." }, 503);
  }
}

export async function DELETE(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (!authenticatedOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "Expected JSON request." }, 415);
  }
  const parsed = z.object({ connectionId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid connection." }, 400);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("user_oauth_connections")
    .select("id").eq("id", parsed.data.connectionId)
    .eq("user_id", userId).maybeSingle();
  if (error) return json({ error: "Unable to verify connection ownership." }, 502);
  if (!data) return json({ error: "Connection not found." }, 404);
  const { error: clearError } = await admin.rpc("disconnect_user_oauth_grant", {
    p_connection_id: data.id,
  });
  if (clearError) return json({ error: "Could not disconnect account." }, 502);
  return json({ disconnected: true });
}
