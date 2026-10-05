import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { NousRuntimeAuth } from "@/lib/integrations/nous-portal";

const PORTAL_ACCOUNT_URL = "https://portal.nousresearch.com/api/oauth/account";
const FAL_QUEUE_ORIGIN = "https://fal-queue-gateway.nousresearch.com";
const ATTACHMENT_BUCKET = "local-ai-attachments";
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const EXECUTION_SIGNED_URL_TTL_SECONDS = 20 * 60;
const VERIFY_TIMEOUT_MS = 8_000;

export type NousReferenceTransportVerification = {
  checkedAt: string;
  auth: {
    usable: boolean;
    detail: string | null;
  };
  account: {
    verified: boolean;
    paidAccess: boolean | null;
    toolPoolEnabled: boolean | null;
    falCoverage: boolean | null;
    falGatewayEntitled: boolean;
    managedToolsFlag: boolean | null;
    detail: string | null;
  };
  attachment: {
    requestedCount: number;
    verifiedCount: number;
    handoffReady: boolean;
    signedUrlTtlSeconds: number;
    detail: string | null;
  };
  gateway: {
    origin: string;
    reachable: boolean;
    modelAllowlistStatus: "not-safely-probeable";
    detail: string;
  };
  readyForApprovedSmokeTest: boolean;
};

type NousAccountPayload = {
  paid_service_access?: {
    allowed?: unknown;
    paid_access?: unknown;
  } | null;
  tool_access?: {
    enabled?: unknown;
    coverage?: Record<string, unknown> | null;
  } | null;
  managed_tools?: unknown;
};

function accessTokenFromRuntimeAuth(auth: NousRuntimeAuth) {
  try {
    const parsed = JSON.parse(auth.sandboxAuthJson) as {
      providers?: { nous?: { access_token?: unknown } };
    };
    const token = parsed.providers?.nous?.access_token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = VERIFY_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyAccount(accessToken: string) {
  try {
    const response = await fetchWithTimeout(PORTAL_ACCOUNT_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return {
        verified: false,
        paidAccess: null,
        toolPoolEnabled: null,
        falCoverage: null,
        falGatewayEntitled: false,
        managedToolsFlag: null,
        detail: `Nous Portal account verification returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as NousAccountPayload;
    const paidAccess =
      payload.paid_service_access?.allowed === true ||
      payload.paid_service_access?.paid_access === true;
    const toolPoolEnabled = payload.tool_access?.enabled === true;
    const falCoverage = payload.tool_access?.coverage?.fal === true;
    const falGatewayEntitled = paidAccess || (toolPoolEnabled && falCoverage);
    const managedToolsFlag =
      typeof payload.managed_tools === "boolean" ? payload.managed_tools : null;

    return {
      verified: true,
      paidAccess,
      toolPoolEnabled,
      falCoverage,
      falGatewayEntitled,
      managedToolsFlag,
      detail: falGatewayEntitled
        ? null
        : "The connected Nous account is valid, but its current paid/tool-pool entitlement does not cover managed FAL image generation.",
    };
  } catch (error) {
    return {
      verified: false,
      paidAccess: null,
      toolPoolEnabled: null,
      falCoverage: null,
      falGatewayEntitled: false,
      managedToolsFlag: null,
      detail:
        error instanceof Error
          ? `Nous Portal account verification failed: ${error.message}`
          : "Nous Portal account verification failed.",
    };
  }
}

async function verifyGatewayReachable(accessToken: string) {
  try {
    const response = await fetchWithTimeout(FAL_QUEUE_ORIGIN, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: "manual",
    });

    // Root-path semantics are not a model allowlist contract. Any non-5xx HTTP
    // response proves the managed gateway host was reached without submitting a
    // generation. 401/403 remain reachable but account verification is the
    // authoritative entitlement check above.
    return response.status < 500;
  } catch {
    return false;
  }
}

async function verifyAttachments(
  ownerRef: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) {
    return {
      requestedCount: 0,
      verifiedCount: 0,
      handoffReady: false,
      signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
      detail: "A reference-image attachment is required for handoff verification.",
    };
  }

  const admin = createAdminSupabaseClient();
  const uniqueIds = [...new Set(attachmentIds)].slice(0, 16);
  const { data: rows, error } = await admin
    .from("local_ai_attachments")
    .select("id,storage_path,mime_type,size_bytes")
    .eq("owner_ref", ownerRef)
    .in("id", uniqueIds);

  if (error) {
    return {
      requestedCount: uniqueIds.length,
      verifiedCount: 0,
      handoffReady: false,
      signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
      detail: `Attachment lookup failed: ${error.message}`,
    };
  }

  const byId = new Map((rows || []).map((row) => [row.id, row]));
  let verifiedCount = 0;

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) continue;

    const { data: signed, error: signError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) continue;

    let parsed: URL;
    try {
      parsed = new URL(signed.signedUrl);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;

    try {
      const response = await fetchWithTimeout(signed.signedUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "error",
      });
      if (response.ok || response.status === 206) {
        verifiedCount += 1;
      }
    } catch {
      // Fail closed. The signed URL is not returned to the client.
    }
  }

  const handoffReady =
    uniqueIds.length > 0 && verifiedCount === uniqueIds.length;

  return {
    requestedCount: uniqueIds.length,
    verifiedCount,
    handoffReady,
    signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
    detail: handoffReady
      ? null
      : `Verified ${verifiedCount} of ${uniqueIds.length} short-lived HTTPS reference URLs.`,
  };
}

export async function createReferenceImageExecutionUrls(input: {
  ownerRef: string;
  attachmentIds: string[];
}) {
  if (!input.attachmentIds.length) {
    throw new Error("A reference-image attachment is required.");
  }

  const admin = createAdminSupabaseClient();
  const uniqueIds = [...new Set(input.attachmentIds)].slice(0, 16);
  const { data: rows, error } = await admin
    .from("local_ai_attachments")
    .select("id,storage_path")
    .eq("owner_ref", input.ownerRef)
    .in("id", uniqueIds);

  if (error) throw error;
  if (!rows || rows.length !== uniqueIds.length) {
    throw new Error("One or more reference-image attachments are unavailable.");
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const urls: string[] = [];

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) throw new Error("Reference-image attachment metadata is missing.");

    const { data: signed, error: signError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(
        row.storage_path,
        EXECUTION_SIGNED_URL_TTL_SECONDS,
      );
    if (signError || !signed?.signedUrl) {
      throw signError || new Error("Could not create a reference-image URL.");
    }

    const parsed = new URL(signed.signedUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("Reference-image handoff requires HTTPS.");
    }
    urls.push(signed.signedUrl);
  }

  return {
    urls,
    ttlSeconds: EXECUTION_SIGNED_URL_TTL_SECONDS,
  };
}

// Backward-compatible alias for the original Nous-only reference path.
export const createNousReferenceImageExecutionUrls =
  createReferenceImageExecutionUrls;

export async function verifyNousReferenceImageTransport(input: {
  ownerRef: string;
  attachmentIds: string[];
  runtimeAuth: NousRuntimeAuth | null;
}): Promise<NousReferenceTransportVerification> {
  const checkedAt = new Date().toISOString();

  if (!input.runtimeAuth) {
    return {
      checkedAt,
      auth: {
        usable: false,
        detail: "Nous Portal is not connected or its authorization is not currently usable.",
      },
      account: {
        verified: false,
        paidAccess: null,
        toolPoolEnabled: null,
        falCoverage: null,
        falGatewayEntitled: false,
        managedToolsFlag: null,
        detail: "Account entitlement was not checked because usable Nous authorization is unavailable.",
      },
      attachment: await verifyAttachments(input.ownerRef, input.attachmentIds),
      gateway: {
        origin: FAL_QUEUE_ORIGIN,
        reachable: false,
        modelAllowlistStatus: "not-safely-probeable",
        detail:
          "No model submission was made. The managed gateway does not expose a documented zero-spend per-model allowlist preflight in the pinned Hermes integration.",
      },
      readyForApprovedSmokeTest: false,
    };
  }

  const accessToken = accessTokenFromRuntimeAuth(input.runtimeAuth);
  if (!accessToken) {
    return {
      checkedAt,
      auth: {
        usable: false,
        detail: "The refreshed Nous authorization document did not contain a usable access token.",
      },
      account: {
        verified: false,
        paidAccess: null,
        toolPoolEnabled: null,
        falCoverage: null,
        falGatewayEntitled: false,
        managedToolsFlag: null,
        detail: "Account entitlement could not be checked.",
      },
      attachment: await verifyAttachments(input.ownerRef, input.attachmentIds),
      gateway: {
        origin: FAL_QUEUE_ORIGIN,
        reachable: false,
        modelAllowlistStatus: "not-safely-probeable",
        detail:
          "No model submission was made. Per-model gateway allowlisting remains unproven.",
      },
      readyForApprovedSmokeTest: false,
    };
  }

  const [account, attachment, gatewayReachable] = await Promise.all([
    verifyAccount(accessToken),
    verifyAttachments(input.ownerRef, input.attachmentIds),
    verifyGatewayReachable(accessToken),
  ]);

  return {
    checkedAt,
    auth: {
      usable: true,
      detail: null,
    },
    account,
    attachment,
    gateway: {
      origin: FAL_QUEUE_ORIGIN,
      reachable: gatewayReachable,
      modelAllowlistStatus: "not-safely-probeable",
      detail:
        "CoOperative verified the connected account, managed-FAL entitlement, gateway reachability, and short-lived HTTPS attachment transport without submitting a generation. The pinned Hermes gateway exposes no documented zero-spend per-model allowlist check, so endpoint billing/allowlisting must be confirmed by the first explicitly approved generation.",
    },
    readyForApprovedSmokeTest:
      account.verified &&
      account.falGatewayEntitled &&
      attachment.handoffReady &&
      gatewayReachable,
  };
}
