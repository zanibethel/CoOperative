import "server-only";
import { randomUUID } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  exchangeUserOAuthToken,
  tokenExpiry,
  userOAuthProvider,
} from "@/lib/integrations/user-oauth-providers";

type OAuthConnection = {
  id: string;
  user_id: string;
  provider_key: string;
  provider_account_id: string;
  account_label: string | null;
  expires_at: string | null;
  granted_scopes: string[];
  connection_status: string;
};

type OAuthVaultDocument = {
  access_token?: string;
  refresh_token?: string | null;
};

function isFresh(connection: OAuthConnection) {
  return !connection.expires_at ||
    new Date(connection.expires_at).getTime() > Date.now() + 90_000;
}

async function readVaultGrant(connectionId: string): Promise<OAuthVaultDocument> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("read_user_oauth_grant", {
    p_connection_id: connectionId,
  });
  if (error || !data || typeof data !== "object") {
    throw new Error("Provider connection needs to be authorized again.");
  }
  return data as OAuthVaultDocument;
}

/**
 * Server-only token broker. Caller must derive userId from the authenticated
 * CoOperative session, never from untrusted model output or client parameters.
 * No OAuth token is returned to a browser or included in a model prompt.
 */
export async function authorizedUserOAuthAccessToken(
  userId: string,
  providerKey: string,
  providerAccountId?: string,
): Promise<string> {
  const provider = userOAuthProvider(providerKey);
  if (!provider) throw new Error("Unsupported OAuth provider.");
  const admin = createAdminSupabaseClient();
  let query = admin.from("user_oauth_connections")
    .select("id,user_id,provider_key,provider_account_id,account_label,expires_at,granted_scopes,connection_status")
    .eq("user_id", userId)
    .eq("provider_key", providerKey)
    .eq("connection_status", "connected");
  if (providerAccountId) query = query.eq("provider_account_id", providerAccountId);

  const { data: connections, error } = await query.limit(3);
  if (error) throw new Error("Could not read provider authorization.");
  if (!connections?.length) throw new Error("Please connect " + provider.name + " first.");
  if (connections.length !== 1) {
    throw new Error("Choose which " + provider.name + " account to use.");
  }
  const connection = connections[0] as OAuthConnection;
  const initial = await readVaultGrant(connection.id);
  if (!initial.access_token) throw new Error("Provider account needs reconnecting.");
  if (isFresh(connection)) return initial.access_token;
  if (!initial.refresh_token) {
    await admin.from("user_oauth_connections")
      .update({ connection_status: "reconnect-required" })
      .eq("id", connection.id).eq("user_id", userId);
    throw new Error("Provider session expired. Please reconnect " + provider.name + ".");
  }

  const leaseToken = randomUUID();
  const { data: acquired, error: leaseError } =
    await admin.rpc("try_acquire_user_oauth_refresh_lease", {
      p_connection_id: connection.id,
      p_lease_token: leaseToken,
    });
  if (leaseError) throw new Error("Could not refresh provider authorization.");
  if (!acquired) throw new Error("Provider authorization is currently refreshing. Retry shortly.");

  try {
    // Reread after acquiring the lock: a prior request may already have rotated the grant.
    const { data: updated, error: updatedError } = await admin
      .from("user_oauth_connections")
      .select("id,user_id,provider_key,provider_account_id,account_label,expires_at,granted_scopes,connection_status")
      .eq("id", connection.id).eq("user_id", userId).single();
    if (updatedError || !updated || updated.connection_status !== "connected") {
      throw new Error("Provider session is no longer connected.");
    }
    const current = updated as OAuthConnection;
    const grant = await readVaultGrant(current.id);
    if (isFresh(current) && grant.access_token) return grant.access_token;
    if (!grant.refresh_token) throw new Error("Provider did not issue a refresh token.");

    const refreshed = await exchangeUserOAuthToken(provider, {
      refreshToken: grant.refresh_token,
    });
    const { error: storeError } = await admin.rpc("store_user_oauth_grant", {
      p_user_id: userId,
      p_provider_key: current.provider_key,
      p_provider_account_id: current.provider_account_id,
      p_account_label: current.account_label,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token || null,
      p_expires_at: tokenExpiry(refreshed.expires_in),
      p_scopes: current.granted_scopes,
    });
    if (storeError) throw new Error("Could not preserve refreshed authorization.");
    return refreshed.access_token!;
  } catch {
    // Do not silently reuse potentially invalid or revoked provider credentials.
    await admin.from("user_oauth_connections")
      .update({ connection_status: "reconnect-required" })
      .eq("id", connection.id).eq("user_id", userId);
    throw new Error("Authorization could not be refreshed. Reconnect " + provider.name + ".");
  } finally {
    await admin.rpc("release_user_oauth_refresh_lease", {
      p_connection_id: connection.id,
      p_lease_token: leaseToken,
    });
  }
}
