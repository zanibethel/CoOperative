export type ServiceConnectorAuthKind =
  | "oauth"
  | "api-key"
  | "guided"
  | "browser"
  | "manual";

export type ServiceConnectorDescriptor = {
  providerKey: string;
  providerName: string;
  authKind: ServiceConnectorAuthKind;
  implementation: "available" | "build-required";
  aliases: string[];
  endpoint?: string;
  credentialHelpUrl?: string;
};

export const SERVICE_CONNECTOR_REGISTRY_REVISION = "2026-10-04.1";

export const SERVICE_CONNECTOR_REGISTRY: ServiceConnectorDescriptor[] = [
  {
    providerKey: "nous-portal",
    providerName: "Nous Portal",
    authKind: "oauth",
    implementation: "available",
    aliases: ["nous", "nous portal", "hermes portal", "hermes"],
    endpoint: "/api/local-ai/nous-connect",
  },
  {
    providerKey: "openrouter-api",
    providerName: "OpenRouter",
    authKind: "api-key",
    implementation: "available",
    aliases: ["openrouter", "open router"],
    endpoint: "/api/local-ai/service-connect",
    credentialHelpUrl: "https://openrouter.ai/settings/keys",
  },
  {
    providerKey: "openai-api",
    providerName: "OpenAI",
    authKind: "api-key",
    implementation: "available",
    aliases: ["openai", "open ai", "openai api"],
    endpoint: "/api/local-ai/service-connect",
    credentialHelpUrl: "https://platform.openai.com/api-keys",
  },
  {
    providerKey: "anthropic-claude",
    providerName: "Claude",
    authKind: "api-key",
    implementation: "available",
    aliases: ["claude", "anthropic", "anthropic claude", "claude api"],
    endpoint: "/api/local-ai/service-connect",
    credentialHelpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    providerKey: "google-gemini",
    providerName: "Gemini",
    authKind: "api-key",
    implementation: "available",
    aliases: ["gemini", "google gemini", "gemini api"],
    endpoint: "/api/local-ai/service-connect",
    credentialHelpUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    providerKey: "google-workspace",
    providerName: "Google Workspace",
    authKind: "oauth",
    implementation: "build-required",
    aliases: [
      "google workspace",
      "gmail",
      "google calendar",
      "google drive",
      "google docs",
      "google account",
    ],
  },
  {
    providerKey: "quickbooks-online",
    providerName: "QuickBooks Online",
    authKind: "oauth",
    implementation: "build-required",
    aliases: ["quickbooks", "quickbooks online", "qbo"],
  },
  {
    providerKey: "shopify",
    providerName: "Shopify",
    authKind: "oauth",
    implementation: "build-required",
    aliases: ["shopify"],
  },
  {
    providerKey: "square",
    providerName: "Square",
    authKind: "oauth",
    implementation: "build-required",
    aliases: ["square", "square pos"],
  },
  {
    providerKey: "glossgenius",
    providerName: "GlossGenius",
    authKind: "guided",
    implementation: "build-required",
    aliases: ["glossgenius", "gloss genius"],
  },
];

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function serviceConnectorByKey(providerKey: string) {
  return (
    SERVICE_CONNECTOR_REGISTRY.find(
      (connector) => connector.providerKey === providerKey,
    ) || null
  );
}

export function serviceConnectorForText(message: string) {
  const haystack = ` ${normalized(message)} `;

  return (
    SERVICE_CONNECTOR_REGISTRY.find((connector) =>
      [connector.providerName, connector.providerKey, ...connector.aliases].some(
        (alias) => {
          const needle = normalized(alias);
          return Boolean(needle) && haystack.includes(` ${needle} `);
        },
      ),
    ) || null
  );
}

export function serviceConnectorDisplayName(providerKey: string) {
  return serviceConnectorByKey(providerKey)?.providerName || providerKey;
}

export function proposedProviderKey(providerName: string) {
  return normalized(providerName)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
