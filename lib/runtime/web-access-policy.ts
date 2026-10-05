import "server-only";

import { isIP } from "node:net";

export type WebAccessMode = "off" | "auto" | "always";
export type UrlAccessClass =
  | "public-web"
  | "known-connector"
  | "authenticated-private"
  | "local-network"
  | "credential-bearing"
  | "executable-download"
  | "unsafe-scheme"
  | "invalid";

export type UrlAccessDecision = {
  allowed: boolean;
  classification: UrlAccessClass;
  reason: string;
  hostname: string | null;
};

const AUTH_ONLY_HOSTS = new Set([
  "accounts.google.com",
  "accounts.intuit.com",
  "connect.squareup.com",
]);

function connectorManagedUrl(parsed: URL) {
  const hostname = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (AUTH_ONLY_HOSTS.has(hostname)) return true;
  if (hostname === "platform.openai.com" && /\/api-?keys?\b/.test(path)) {
    return true;
  }
  if (hostname === "openrouter.ai" && /\/settings\/keys?\b/.test(path)) {
    return true;
  }
  if (
    hostname === "console.anthropic.com" &&
    /\/(?:settings\/)?keys?\b/.test(path)
  ) {
    return true;
  }
  if (
    hostname === "aistudio.google.com" &&
    /\/(?:app\/)?apikey\b/.test(path)
  ) {
    return true;
  }
  if (hostname === "admin.shopify.com") return true;
  return false;
}

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "code",
  "credential",
  "key",
  "password",
  "refresh_token",
  "secret",
  "token",
]);

const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".msix",
  ".appx",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".bat",
  ".cmd",
  ".ps1",
  ".scr",
  ".com",
  ".jar",
]);

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIpv6(hostname: string) {
  const value = hostname.toLowerCase();
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

function localHostname(hostname: string) {
  const value = hostname.toLowerCase();
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  ) {
    return true;
  }
  const ipVersion = isIP(value);
  if (ipVersion === 4) return isPrivateIpv4(value);
  if (ipVersion === 6) return isPrivateIpv6(value);
  return false;
}

function executablePath(pathname: string) {
  const lower = pathname.toLowerCase();
  for (const extension of EXECUTABLE_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

export function classifyUrlAccess(rawUrl: string): UrlAccessDecision {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      classification: "invalid",
      reason: "The URL is not valid.",
      hostname: null,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      allowed: false,
      classification: "unsafe-scheme",
      reason: "Only HTTP(S) URLs are eligible for web access.",
      hostname: parsed.hostname || null,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      classification: "credential-bearing",
      reason: "Credential-bearing URLs are blocked. Use an approved connector instead.",
      hostname,
    };
  }

  const sensitiveQuery = Array.from(parsed.searchParams.keys()).some((key) =>
    SENSITIVE_QUERY_KEYS.has(key.toLowerCase()),
  );
  const sensitiveFragment =
    /(?:access_token|api_key|apikey|authorization|code|credential|password|refresh_token|secret|token)=/i.test(
      parsed.hash,
    );
  if (sensitiveQuery || sensitiveFragment) {
    return {
      allowed: false,
      classification: "credential-bearing",
      reason:
        "URLs carrying tokens, authorization codes, API keys, or other credentials are blocked from ordinary web access.",
      hostname,
    };
  }

  if (localHostname(hostname)) {
    return {
      allowed: false,
      classification: "local-network",
      reason:
        "Local/private-network URLs are blocked from ordinary web workflows unless a dedicated local-node capability explicitly authorizes them.",
      hostname,
    };
  }

  if (executablePath(parsed.pathname)) {
    return {
      allowed: false,
      classification: "executable-download",
      reason:
        "Executable/package downloads require a dedicated installation or download workflow.",
      hostname,
    };
  }

  if (connectorManagedUrl(parsed)) {
    return {
      allowed: false,
      classification: "known-connector",
      reason:
        "This domain belongs to a known connected-service flow and must use the registered connector/auth path.",
      hostname,
    };
  }

  return {
    allowed: true,
    classification: "public-web",
    reason: "Public HTTP(S) URL is eligible subject to the profile web-access mode.",
    hostname,
  };
}

export function decideWebAccess(input: {
  mode: WebAccessMode;
  url?: string | null;
  needsCurrentExternalInfo?: boolean;
  authenticatedPrivateResource?: boolean;
  connectorAuthorized?: boolean;
}): UrlAccessDecision {
  if (input.mode === "off") {
    return {
      allowed: false,
      classification: "public-web",
      reason: "Profile web access is Off.",
      hostname: null,
    };
  }

  if (input.authenticatedPrivateResource && !input.connectorAuthorized) {
    return {
      allowed: false,
      classification: "authenticated-private",
      reason:
        "Authenticated/private resources require an approved connected-service authorization.",
      hostname: null,
    };
  }

  if (input.url) {
    const classified = classifyUrlAccess(input.url);
    if (classified.classification === "known-connector") {
      return input.connectorAuthorized
        ? {
            ...classified,
            allowed: true,
            reason: "Known connector domain is authorized through its registered connection.",
          }
        : classified;
    }
    if (!classified.allowed) return classified;
    if (input.mode === "auto" && !input.needsCurrentExternalInfo) {
      return {
        ...classified,
        allowed: false,
        reason:
          "Web access is Auto, but deterministic routing did not identify a need for current external information.",
      };
    }
    return classified;
  }

  if (input.mode === "auto" && !input.needsCurrentExternalInfo) {
    return {
      allowed: false,
      classification: "public-web",
      reason:
        "Web access is Auto, but deterministic routing did not identify a need for current external information.",
      hostname: null,
    };
  }

  return {
    allowed: true,
    classification: "public-web",
    reason:
      input.mode === "always"
        ? "Profile Web mode is Always."
        : "Profile Web mode is Auto and current external information is required.",
    hostname: null,
  };
}

const EXTERNAL_QUERY_SECRET_PATTERNS = [
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|bearer|password|secret|credential)\b\s*[:=]?\s*\S+/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
];

export function externalSearchQuerySafe(query: string) {
  const value = query.trim();
  if (!value) return false;
  return !EXTERNAL_QUERY_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function needsCurrentExternalInfo(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return false;

  const triggers = [
    "search the web",
    "search online",
    "look online",
    "look this up",
    "latest",
    "today",
    "current ",
    "currently",
    "right now",
    "news",
    "weather",
    "price",
    "prices",
    "score",
    "scores",
    "schedule",
    "release",
    "released",
    "version",
    "update",
    "updates",
    "this week",
    "this month",
    "recent",
    "available now",
    "in stock",
    "open now",
    "hours today",
  ];

  return triggers.some((trigger) => value.includes(trigger));
}

export function explicitPublicUrlReadIntent(message: string) {
  if (!/https?:\/\/\S+/i.test(message)) return false;
  return /\b(?:open|read|review|check|inspect|visit|summarize|analyse|analyze|look at|what(?:'s| is) on|from this|use this (?:link|url|page|site))\b/i.test(
    message,
  );
}

export function parseWebAccessModeCommand(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  const asksStatus =
    /\b(?:what(?:'s| is)|show|tell me|check)\b/.test(value) &&
    /\b(?:web|online|internet) (?:access|mode|setting|settings)\b/.test(value);

  const setting =
    /\b(?:set|change|make|turn|switch|use)\b/.test(value) &&
    /\b(?:web|online|internet) (?:access|mode|setting|settings)?\b/.test(value);

  if (setting) {
    if (/\b(?:off|disable|disabled|no web)\b/.test(value)) {
      return { action: "set" as const, mode: "off" as const };
    }
    if (/\b(?:always|on|enable|enabled)\b/.test(value)) {
      return { action: "set" as const, mode: "always" as const };
    }
    if (/\bauto(?:matic|matically)?\b/.test(value)) {
      return { action: "set" as const, mode: "auto" as const };
    }
  }

  return asksStatus ? { action: "read" as const } : null;
}
