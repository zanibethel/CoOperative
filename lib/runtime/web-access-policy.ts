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

const KNOWN_CONNECTOR_HOSTS = new Set([
  "accounts.google.com",
  "console.anthropic.com",
  "aistudio.google.com",
  "platform.openai.com",
  "openrouter.ai",
  "app.quickbooks.intuit.com",
  "accounts.intuit.com",
  "admin.shopify.com",
  "connect.squareup.com",
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

  if (KNOWN_CONNECTOR_HOSTS.has(hostname)) {
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
