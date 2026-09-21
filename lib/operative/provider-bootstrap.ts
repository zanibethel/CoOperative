import type { LinkedProjectKey } from "./project-registry.ts";

export type ProviderBootstrapAuthMethod =
  | "oauth"
  | "personal-api-key"
  | "developer-app";

export type ProviderBootstrapHandoff = {
  mode: "external-browser" | "oauth-redirect";
  resume: "local-session" | "oauth-callback";
  credentialDelivery: "owner-paste-to-broker" | "oauth-token-exchange";
};

export interface ProviderBootstrapDefinition {
  projectKey: LinkedProjectKey;
  providerKey: string;
  providerName: string;
  preferredAuthOrder: readonly ProviderBootstrapAuthMethod[];
  currentlySupportedAuth: ProviderBootstrapAuthMethod;
  handoff: ProviderBootstrapHandoff;
  humanActionKey: string;
  secretKeys: readonly string[];
  verification: {
    projectHealth: boolean;
    capabilityPath?: string;
  };
  automatedAfterHandoff: readonly string[];
  humanRequiredFor: readonly string[];
}

/**
 * Provider Bootstrap is the deterministic setup contract CoOperative uses
 * before considering Hermes. The goal is to automate everything around the
 * provider's unavoidable identity/consent boundary.
 */
const PROVIDER_BOOTSTRAPS: readonly ProviderBootstrapDefinition[] = [
  {
    projectKey: "creatorhub",
    providerKey: "eromify",
    providerName: "Eromify",
    preferredAuthOrder: ["oauth", "personal-api-key"],
    // Eromify documents OAuth for its Claude connector, but custom scripts
    // currently use a personal API key. Until generic custom-client OAuth is
    // verified, CoOperative fails closed to the documented script path.
    currentlySupportedAuth: "personal-api-key",
    handoff: {
      // Eromify's website login can use Google, but that authenticates the
      // browser session rather than a verified generic OAuth API flow.
      // Keep the real browser outside the embedded frame and resume the
      // CoOperative setup session after the owner returns with the MCP key.
      mode: "external-browser",
      resume: "local-session",
      credentialDelivery: "owner-paste-to-broker",
    },
    humanActionKey: "eromify-mcp-api-key",
    secretKeys: ["EROMIFY_API_KEY"],
    verification: {
      projectHealth: true,
      capabilityPath: "/api/eromify/capabilities",
    },
    automatedAfterHandoff: [
      "broker the approved secret directly to the target environment",
      "require a separate deployment gate before claiming the secret is live",
      "verify CreatorHub integration health",
      "discover the live Eromify MCP tool catalog",
      "record the successful bootstrap pattern for reuse",
    ],
    humanRequiredFor: [
      "provider sign-in when no reusable authenticated session exists",
      "MFA, CAPTCHA, identity verification, or provider consent",
      "creating the Eromify personal API key while custom-client OAuth is unavailable",
    ],
  },
];

export function getProviderBootstrap(
  projectKey: string,
  providerKey: string,
): ProviderBootstrapDefinition | null {
  return (
    PROVIDER_BOOTSTRAPS.find(
      (entry) =>
        entry.projectKey === projectKey &&
        entry.providerKey.toLowerCase() === providerKey.toLowerCase(),
    ) ?? null
  );
}

export function providerBootstrapsForProject(
  projectKey: string,
): ProviderBootstrapDefinition[] {
  return PROVIDER_BOOTSTRAPS.filter((entry) => entry.projectKey === projectKey);
}
