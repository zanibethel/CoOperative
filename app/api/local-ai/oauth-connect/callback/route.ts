import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  exchangeUserOAuthToken,
  oauthPublicOrigin,
  tokenExpiry,
  userOAuthExternalAccount,
  userOAuthProvider,
} from "@/lib/integrations/user-oauth-providers";

export const runtime = "nodejs";
export const maxDuration = 30;

function returnToApp(success: boolean, providerKey?: string) {
  const origin = oauthPublicOrigin();
  const url = new URL("/connections", origin);
  url.searchParams.set("oauth", success ? "connected" : "failed");
  if (providerKey) url.searchParams.set("provider", providerKey);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to CoOperative to finish linking." }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
  }

  const params = new URL(request.url).searchParams;
  const state = params.get("state") || "";
  const code = params.get("code") || "";
  // Never consume a callback missing the opaque state.
  if (state.length < 32 || state.length > 256) return returnToApp(false);

  const admin = createAdminSupabaseClient();
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { data: flow, error } = await admin.from("user_oauth_flows")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id,provider_key,pkce_verifier")
    .maybeSingle();

  if (error || !flow) return returnToApp(false);
  const provider = userOAuthProvider(flow.provider_key);
  if (!provider || !code || params.has("error")) {
    await admin.from("user_oauth_flows").update({ status: "failed" })
      .eq("id", flow.id).eq("user_id", userId);
    return returnToApp(false, flow.provider_key);
  }

  try {
    const token = await exchangeUserOAuthToken(provider, {
      code,
      verifier: flow.pkce_verifier || undefined,
    });
    const account = await userOAuthExternalAccount(provider, token.access_token!);
    const scopes = token.scope
      ? token.scope.split(/[,\s]+/).filter(Boolean)
      : provider.scopes;
    if (provider.scopes.some((scope) => !scopes.includes(scope))) {
      throw new Error("Required provider permissions were not granted.");
    }

    const { error: storeError } = await admin.rpc("store_user_oauth_grant", {
      p_user_id: userId,
      p_provider_key: provider.key,
      p_provider_account_id: account.id,
      p_account_label: account.label,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token || null,
      p_expires_at: tokenExpiry(token.expires_in),
      p_scopes: scopes,
    });
    if (storeError) throw new Error("Could not save authorized account.");

    const { error: finishError } = await admin.from("user_oauth_flows")
      .update({ status: "approved" }).eq("id", flow.id).eq("user_id", userId);
    if (finishError) throw new Error("Could not finalize authorization.");
    return returnToApp(true, provider.key);
  } catch {
    await admin.from("user_oauth_flows")
      .update({ status: "failed" }).eq("id", flow.id).eq("user_id", userId);
    return returnToApp(false, provider.key);
  }
}
