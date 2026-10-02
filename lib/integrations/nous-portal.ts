import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";

const PORTAL_URL = "https://portal.nousresearch.com";
const DEFAULT_INFERENCE_URL = "https://inference-api.nousresearch.com/v1";
const WELCOME_INFERENCE_URL = "https://welcome-api.nousresearch.com/v1";
const CLIENT_ID = "hermes-cli";
const SCOPE = "inference:invoke";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

type NousState = {
  access_token: string;
  refresh_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
  client_id: string;
  portal_base_url: string;
  inference_base_url: string;
  obtained_at: string;
  expires_in: number;
  expires_at: string;
  agent_key?: string | null;
  agent_key_expires_at?: string | null;
  agent_key_expires_in?: number | null;
  agent_key_reused?: boolean | null;
  agent_key_obtained_at?: string | null;
};

export type NousDeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  pollIntervalSeconds: number;
};

export type NousRuntimeAuth = {
  serviceId: string;
  sandboxAuthJson: string;
  accessTokenExpiresAt: string;
  inferenceBaseUrl: string;
};

function safeInferenceUrl(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  if (text === DEFAULT_INFERENCE_URL || text === WELCOME_INFERENCE_URL) return text;
  return DEFAULT_INFERENCE_URL;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isoAfter(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function stateFromTokenPayload(
  payload: Record<string, unknown>,
  previous?: NousState,
): NousState {
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) throw new Error("Nous Portal did not return an access token.");

  const expiresIn = positiveInt(payload.expires_in, 900);
  const now = new Date().toISOString();
  const refreshToken =
    typeof payload.refresh_token === "string" && payload.refresh_token.trim()
      ? payload.refresh_token.trim()
      : previous?.refresh_token || null;
  const scope =
    typeof payload.scope === "string" && payload.scope.trim()
      ? payload.scope.trim()
      : previous?.scope || SCOPE;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type:
      typeof payload.token_type === "string" && payload.token_type.trim()
        ? payload.token_type.trim()
        : previous?.token_type || "Bearer",
    scope,
    client_id: CLIENT_ID,
    portal_base_url: PORTAL_URL,
    inference_base_url: safeInferenceUrl(
      payload.inference_base_url || previous?.inference_base_url,
    ),
    obtained_at: now,
    expires_in: expiresIn,
    expires_at: isoAfter(expiresIn),
    agent_key: accessToken,
    agent_key_expires_at: isoAfter(expiresIn),
    agent_key_expires_in: expiresIn,
    agent_key_reused: false,
    agent_key_obtained_at: now,
  };
}

function authDocument(state: NousState, includeRefresh: boolean) {
  const providerState = includeRefresh
    ? state
    : { ...state, refresh_token: null };

  return JSON.stringify({
    version: 1,
    active_provider: "nous",
    providers: {
      nous: providerState,
    },
  });
}

function parseStoredState(raw: string): NousState {
  const parsed = JSON.parse(raw) as {
    providers?: { nous?: NousState };
  };
  const state = parsed?.providers?.nous;
  if (
    !state ||
    typeof state.access_token !== "string" ||
    typeof state.client_id !== "string"
  ) {
    throw new Error("Stored Nous Portal authorization is invalid.");
  }
  return state;
}

async function formPost(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function startNousDeviceAuthorization(): Promise<NousDeviceStart> {
  const response = await formPost(`${PORTAL_URL}/api/oauth/device/code`, {
    client_id: CLIENT_ID,
    scope: SCOPE,
  });
  if (!response.ok) {
    throw new Error(`Nous Portal sign-in could not start (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const deviceCode =
    typeof payload.device_code === "string" ? payload.device_code : "";
  const userCode = typeof payload.user_code === "string" ? payload.user_code : "";
  const verificationUrl =
    typeof payload.verification_uri_complete === "string"
      ? payload.verification_uri_complete
      : typeof payload.verification_uri === "string"
        ? payload.verification_uri
        : "";
  const expiresIn = positiveInt(payload.expires_in, 300);
  const pollIntervalSeconds = Math.max(1, positiveInt(payload.interval, 2));

  if (!deviceCode || !userCode || !verificationUrl) {
    throw new Error("Nous Portal returned an incomplete device authorization response.");
  }

  return {
    deviceCode,
    userCode,
    verificationUrl,
    expiresIn,
    pollIntervalSeconds,
  };
}

export async function pollNousDeviceAuthorization(deviceCode: string) {
  const response = await formPost(`${PORTAL_URL}/api/oauth/token`, {
    grant_type: DEVICE_GRANT,
    client_id: CLIENT_ID,
    device_code: deviceCode,
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.ok) {
    return {
      status: "approved" as const,
      state: stateFromTokenPayload(payload),
    };
  }

  const code = typeof payload.error === "string" ? payload.error : "";
  if (code === "authorization_pending" || code === "slow_down") {
    return {
      status: "pending" as const,
      slowDown: code === "slow_down",
    };
  }
  if (code === "access_denied") {
    return { status: "denied" as const };
  }
  if (code === "expired_token") {
    return { status: "expired" as const };
  }

  const description =
    typeof payload.error_description === "string"
      ? payload.error_description
      : `Nous Portal authorization failed (HTTP ${response.status}).`;
  throw new Error(description);
}

export function storedNousAuthDocument(state: NousState) {
  return authDocument(state, true);
}

async function refreshNousState(state: NousState) {
  const refreshToken = state.refresh_token?.trim();
  if (!refreshToken) {
    throw new Error("Nous Portal needs to be reconnected because no refresh grant is available.");
  }

  const response = await formPost(
    `${PORTAL_URL}/api/oauth/token`,
    {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
    },
    { "x-nous-refresh-token": refreshToken },
  );

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "";
    if (
      code === "invalid_grant" ||
      code === "invalid_token" ||
      code === "refresh_token_reused"
    ) {
      throw new Error("Nous Portal authorization expired or was rotated elsewhere. Reconnect Nous Portal.");
    }
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : `Nous Portal refresh failed (HTTP ${response.status}).`,
    );
  }

  return stateFromTokenPayload(payload, state);
}

function accessIsFresh(state: NousState) {
  const expiresAt = Date.parse(state.expires_at || "");
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS;
}

async function readLatest(ownerRef: string) {
  const connected = await businessOwnedServiceCredentialForOwner(
    ownerRef,
    "nous-portal",
  );
  if (!connected) return null;
  return {
    ...connected,
    state: parseStoredState(connected.credential),
  };
}

export async function freshNousRuntimeAuthForOwner(
  ownerRef: string,
): Promise<NousRuntimeAuth | null> {
  let current = await readLatest(ownerRef);
  if (!current) return null;

  if (!accessIsFresh(current.state)) {
    const admin = createAdminSupabaseClient();
    const leaseToken = crypto.randomUUID();
    const { data: acquired, error: leaseError } = await admin.rpc(
      "try_acquire_connected_service_auth_lease",
      {
        p_service_id: current.serviceId,
        p_lease_token: leaseToken,
        p_lease_seconds: 30,
      },
    );
    if (leaseError) throw leaseError;

    if (acquired) {
      try {
        const refreshed = await refreshNousState(current.state);
        const { error: storeError } = await admin.rpc(
          "store_connected_service_credential",
          {
            p_service_id: current.serviceId,
            p_secret: storedNousAuthDocument(refreshed),
          },
        );
        if (storeError) throw storeError;
        current = { ...current, state: refreshed };
      } finally {
        await admin.rpc("release_connected_service_auth_lease", {
          p_service_id: current.serviceId,
          p_lease_token: leaseToken,
        });
      }
    } else {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const latest = await readLatest(ownerRef);
        if (latest && accessIsFresh(latest.state)) {
          current = latest;
          break;
        }
      }
      if (!accessIsFresh(current.state)) {
        throw new Error("Nous Portal authorization is refreshing. Try the request again in a moment.");
      }
    }
  }

  return {
    serviceId: current.serviceId,
    sandboxAuthJson: authDocument(current.state, false),
    accessTokenExpiresAt: current.state.expires_at,
    inferenceBaseUrl: current.state.inference_base_url,
  };
}
