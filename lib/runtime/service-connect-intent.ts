export type ServiceConnectIntent =
  | {
      providerKey: "openrouter-api";
      providerName: "OpenRouter";
      kind: "api-key";
    }
  | {
      providerKey: "nous-portal";
      providerName: "Nous Portal";
      kind: "oauth";
    };

const OPENROUTER_PATTERN = /\bopen\s*router\b|\bopenrouter\b/i;
const NOUS_PATTERN =
  /\bnous\b|\bnous\s+portal\b|\bhermes\s+portal\b|\bhermes\s+(?:free|included)\s+models?\b/i;
const CONNECTION_PATTERN =
  /\b(connect|setup|set up|configure|configured|configuration|sign in|login|log in|link|api key|key|credential|got the key|have the key|ready to connect)\b/i;
const GENERIC_KEY_READY_PATTERN =
  /\b(i\s+)?(got|have|created|made|generated)\b.{0,18}\b(api\s+)?key\b|\bready\b.{0,18}\bkey\b/i;

export function planServiceConnectIntent(
  message: string,
  recentAssistantMessages: string[] = [],
): ServiceConnectIntent | null {
  const text = message.trim();
  if (!text) return null;

  if (NOUS_PATTERN.test(text) && CONNECTION_PATTERN.test(text)) {
    return {
      providerKey: "nous-portal",
      providerName: "Nous Portal",
      kind: "oauth",
    };
  }

  if (OPENROUTER_PATTERN.test(text) && CONNECTION_PATTERN.test(text)) {
    return {
      providerKey: "openrouter-api",
      providerName: "OpenRouter",
      kind: "api-key",
    };
  }

  if (GENERIC_KEY_READY_PATTERN.test(text)) {
    const hasPendingOpenRouter = recentAssistantMessages.some((content) =>
      /SECURE_SERVICE_CONNECT:openrouter-api/i.test(content),
    );
    if (hasPendingOpenRouter) {
      return {
        providerKey: "openrouter-api",
        providerName: "OpenRouter",
        kind: "api-key",
      };
    }
  }

  return null;
}

export function serviceConnectAssistantMessage(intent: ServiceConnectIntent) {
  if (intent.kind === "oauth") {
    return [
      `I can connect ${intent.providerName} to CoOperative from here.`,
      "",
      "Use the secure sign-in card below. You’ll approve CoOperative/Hermes in Nous Portal once; CoOperative keeps the rotating refresh grant encrypted server-side and gives temporary Hermes workers only short-lived access.",
      "",
      `OAUTH_SERVICE_CONNECT:${intent.providerKey}`,
    ].join("\n");
  }

  return [
    `Perfect. I can connect ${intent.providerName} for Hermes from here.`,
    "",
    "Paste the API key into the secure field below—not into normal chat. CoOperative will verify it directly with the provider, encrypt it in the server-side vault, and only expose it to an approved Hermes job when needed.",
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
