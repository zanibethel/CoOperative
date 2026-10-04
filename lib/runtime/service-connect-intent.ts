import {
  proposedProviderKey,
  serviceConnectorByKey,
  serviceConnectorForText,
  type ServiceConnectorAuthKind,
} from "@/lib/runtime/service-connector-registry";

export type ServiceConnectIntent =
  | {
      type: "available";
      providerKey: string;
      providerName: string;
      kind: "api-key" | "oauth";
    }
  | {
      type: "build-required";
      providerKey: string;
      providerName: string;
      kind: ServiceConnectorAuthKind | "unknown";
      source: "known-registry" | "unknown-provider";
    };

const CONNECTION_PATTERN =
  /\b(connect|setup|set up|configure|configured|configuration|sign in|signin|log in|login|link|authorize|integrate|integration|api key|credential|got the key|have the key|ready to connect)\b/i;
const GENERIC_KEY_READY_PATTERN =
  /\b(i\s+)?(got|have|created|made|generated)\b.{0,18}\b(api\s+)?key\b|\bready\b.{0,18}\bkey\b/i;

function cleanedProviderCandidate(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();

  const patterns = [
    /\b(?:connect|link|authorize|integrate)\s+(?:to\s+|with\s+|my\s+|our\s+|the\s+)?(.{2,80}?)(?:[?.!]|$)/i,
    /\b(?:sign\s*in|log\s*in|login)\s+(?:to\s+|with\s+)?(.{2,80}?)(?:[?.!]|$)/i,
    /\b(?:setup|set up|configure)\s+(?:my\s+|our\s+|the\s+)?(.{2,80}?)(?:\s+(?:connection|integration|account))?(?:[?.!]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const raw = match?.[1]
      ?.replace(/\b(?:account|service|provider|integration|connection)\b$/i, "")
      .trim();
    if (!raw) continue;

    const normalized = raw.toLowerCase();
    if (
      [
        "a provider",
        "provider",
        "service",
        "a service",
        "my account",
        "account",
        "third party",
        "third-party",
      ].includes(normalized)
    ) {
      continue;
    }

    return raw.slice(0, 80);
  }

  return null;
}

export function planServiceConnectIntent(
  message: string,
  recentAssistantMessages: string[] = [],
): ServiceConnectIntent | null {
  const text = message.trim();
  if (!text) return null;

  const connector = serviceConnectorForText(text);
  const hasConnectionIntent = CONNECTION_PATTERN.test(text);

  if (connector && hasConnectionIntent) {
    if (
      connector.implementation === "available" &&
      (connector.authKind === "oauth" || connector.authKind === "api-key")
    ) {
      return {
        type: "available",
        providerKey: connector.providerKey,
        providerName: connector.providerName,
        kind: connector.authKind,
      };
    }

    return {
      type: "build-required",
      providerKey: connector.providerKey,
      providerName: connector.providerName,
      kind: connector.authKind,
      source: "known-registry",
    };
  }

  if (GENERIC_KEY_READY_PATTERN.test(text)) {
    const pendingMarker = recentAssistantMessages
      .map((content) =>
        content.match(/SECURE_SERVICE_CONNECT:([a-z0-9-]+)/i)?.[1] || null,
      )
      .find(Boolean);

    if (pendingMarker) {
      const pendingConnector = serviceConnectorByKey(pendingMarker);
      if (
        pendingConnector?.implementation === "available" &&
        pendingConnector.authKind === "api-key"
      ) {
        return {
          type: "available",
          providerKey: pendingConnector.providerKey,
          providerName: pendingConnector.providerName,
          kind: "api-key",
        };
      }
    }
  }

  if (!hasConnectionIntent) return null;

  const providerName = cleanedProviderCandidate(text);
  if (!providerName) return null;

  return {
    type: "build-required",
    providerKey: proposedProviderKey(providerName) || "custom-provider",
    providerName,
    kind: "unknown",
    source: "unknown-provider",
  };
}

export function serviceConnectAssistantMessage(
  intent: Extract<ServiceConnectIntent, { type: "available" }>,
) {
  if (intent.kind === "oauth") {
    return [
      `I can connect ${intent.providerName} from here.`,
      "",
      "Use the secure sign-in card below. CoOperative handles the connection flow in code and stores approved authorization state server-side; the AI model does not need your sign-in credentials.",
      "",
      `OAUTH_SERVICE_CONNECT:${intent.providerKey}`,
    ].join("\n");
  }

  return [
    `I can connect ${intent.providerName} from here.`,
    "",
    "Use the secure credential card below rather than pasting the key into normal chat. CoOperative verifies and stores it through the connector code path.",
    "",
    `SECURE_SERVICE_CONNECT:${intent.providerKey}`,
  ].join("\n");
}

export function looksLikeApiCredential(message: string) {
  const text = message.trim();
  return (
    /^sk-or-v1-[A-Za-z0-9_-]{20,}$/i.test(text) ||
    /^sk-[A-Za-z0-9_-]{20,}$/i.test(text) ||
    /^AIza[0-9A-Za-z_-]{20,}$/i.test(text)
  );
}
