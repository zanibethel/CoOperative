import type { CompatibilityTarget } from "./integration-compatibility-registry.ts";

export type LinkedProjectKey = "creatorhub" | "raisehub";

export type HumanActionMode = "embedded-or-popup" | "popup-only";

export interface ProjectSecretRequirement {
  key: string;
  purpose: string;
  secret: boolean;
  ownerGate: boolean;
  environments: readonly ("preview" | "production")[];
}

export interface ProjectHumanAction {
  key: string;
  title: string;
  provider: string;
  description: string;
  launchUrl: string;
  mode: HumanActionMode;
  completion: "manual-return-and-verify";
  callbackUrl?: string;
  resumeSecretKey?: string;
  returnCta?: string;
  externalAuthExpected?: boolean;
  relatedSecretKeys: readonly string[];
}

export interface LinkedProjectManifest {
  key: LinkedProjectKey;
  name: string;
  description: string;
  repoSlug: string;
  defaultRef: string;
  vercelProject: {
    id: string;
    name: string;
  };
  supabaseProjectRef: string | null;
  integrationHealthUrl: string | null;
  healthPlaybookKey: string;
  hermesPlaybookKey: string;
  compatibilityTargets: readonly CompatibilityTarget[];
  executorPreference: readonly (
    | "deterministic-code"
    | "connected-chatgpt"
    | "native-cooperative"
    | "hermes-cloud-operative"
  )[];
  secretRequirements: readonly ProjectSecretRequirement[];
  humanActions: readonly ProjectHumanAction[];
}

const PROJECTS: Record<LinkedProjectKey, LinkedProjectManifest> = {
  creatorhub: {
    key: "creatorhub",
    name: "CreatorHub",
    description:
      "Creator operations, connected platforms, SmartLink, digital products, commerce, and AI-assisted publishing.",
    repoSlug: "zanibethel/CreatorHub",
    defaultRef: "main",
    vercelProject: {
      id: "prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw",
      name: "creatorhub",
    },
    supabaseProjectRef: "yufptpfiwdbzzrvhkvux",
    integrationHealthUrl:
      "https://creatorhub-gray.vercel.app/api/system/integration-health",
    healthPlaybookKey: "creatorhub-health-check",
    hermesPlaybookKey: "creatorhub-hermes-patch",
    compatibilityTargets: [
      "linked-project",
      "provider-auth-handoff",
      "provider-secret-broker",
      "vercel-sandbox",
      "vercel-ai-gateway",
      "supabase",
    ],
    executorPreference: [
      "deterministic-code",
      "connected-chatgpt",
      "native-cooperative",
      "hermes-cloud-operative",
    ],
    secretRequirements: [
      {
        key: "INSTAGRAM_APP_ID",
        purpose: "Instagram professional-account OAuth client identifier.",
        secret: false,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "INSTAGRAM_APP_SECRET",
        purpose: "Instagram OAuth client secret.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "TIKTOK_CLIENT_KEY",
        purpose: "TikTok Login Kit client key.",
        secret: false,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "TIKTOK_CLIENT_SECRET",
        purpose: "TikTok Login Kit client secret.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "FANVUE_CLIENT_ID",
        purpose: "Fanvue OAuth application client identifier.",
        secret: false,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "FANVUE_CLIENT_SECRET",
        purpose: "Fanvue OAuth application client secret.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "STRIPE_SECRET_KEY",
        purpose: "CreatorHub direct checkout server credential.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "STRIPE_WEBHOOK_SECRET",
        purpose: "Verify Stripe webhook signatures.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
      {
        key: "EROMIFY_API_KEY",
        purpose:
          "Server-only personal Eromify MCP API key used by CreatorHub for capability discovery and owner-approved generation.",
        secret: true,
        ownerGate: true,
        environments: ["preview", "production"],
      },
    ],
    humanActions: [
      {
        key: "cooperative-secret-broker-connect",
        title: "Create CoOperative API-key connector",
        provider: "Vercel Connect",
        description:
          "One-time shared setup: create an API-key connector that holds a team-scoped Vercel access token, then attach the connector to CoOperative. The token remains in Vercel Connect rather than CoOperative or Hermes.",
        launchUrl:
          "https://vercel.com/d?title=Vercel+Connect&to=%2F%5Bteam%5D%2F~%2Fconnect%3Fcreate%3Dapi-key",
        mode: "popup-only",
        completion: "manual-return-and-verify",
        relatedSecretKeys: [],
      },
      {
        key: "cooperative-secret-broker-uid",
        title: "CoOperative secret broker · connector UID",
        provider: "Vercel",
        description:
          "CoOperative now knows the reviewed connector UID cooperative-vercel-admin/secret-broker. This environment override is only needed if the connector UID changes later; the UID is not the access token.",
        launchUrl:
          "https://vercel.com/zanibethels-projects/co-operative/settings/environment-variables",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        relatedSecretKeys: ["COOPERATIVE_VERCEL_ADMIN_CONNECTOR"],
      },
      {
        key: "eromify-mcp-api-key",
        title: "Eromify MCP personal API key",
        provider: "Eromify",
        description:
          "Open Eromify in a full browser, use Google/provider sign-in if required, then create a personal MCP API key. Return to CoOperative and it will resume directly at the EROMIFY_API_KEY secure broker step.",
        launchUrl: "https://www.eromify.in/mcp-keys",
        mode: "popup-only",
        completion: "manual-return-and-verify",
        resumeSecretKey: "EROMIFY_API_KEY",
        returnCta: "I have the Eromify API key · continue",
        externalAuthExpected: true,
        relatedSecretKeys: ["EROMIFY_API_KEY"],
      },
      {
        key: "vercel-environment",
        title: "CreatorHub environment variables",
        provider: "Vercel",
        description:
          "Open CreatorHub's Vercel environment settings to add or review owner-approved identifiers and secrets without putting their values into CoOperative or Hermes context.",
        launchUrl:
          "https://vercel.com/zanibethels-projects/creatorhub/settings/environment-variables",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        relatedSecretKeys: [
          "INSTAGRAM_APP_ID",
          "INSTAGRAM_APP_SECRET",
          "TIKTOK_CLIENT_KEY",
          "TIKTOK_CLIENT_SECRET",
          "FANVUE_CLIENT_ID",
          "FANVUE_CLIENT_SECRET",
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "EROMIFY_API_KEY",
        ],
      },
      {
        key: "instagram-developer-app",
        title: "Instagram developer app",
        provider: "Meta",
        description:
          "Sign in to Meta for Developers, create or review the CreatorHub app, and register the production OAuth callback.",
        launchUrl: "https://developers.facebook.com/apps/",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        callbackUrl:
          "https://creatorhub-gray.vercel.app/api/oauth/instagram/callback",
        relatedSecretKeys: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
      },
      {
        key: "tiktok-developer-app",
        title: "TikTok developer app",
        provider: "TikTok",
        description:
          "Sign in to TikTok for Developers, configure Login Kit, and register the production OAuth callback.",
        launchUrl: "https://developers.tiktok.com/apps/",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        callbackUrl:
          "https://creatorhub-gray.vercel.app/api/oauth/tiktok/callback",
        relatedSecretKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
      },
      {
        key: "fanvue-developer-app",
        title: "Fanvue developer app",
        provider: "Fanvue",
        description:
          "Sign in to Fanvue, complete any required creator verification, create the OAuth app, and register the production callback.",
        launchUrl: "https://www.fanvue.com/developers/apps",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        callbackUrl:
          "https://creatorhub-gray.vercel.app/api/oauth/fanvue/callback",
        relatedSecretKeys: ["FANVUE_CLIENT_ID", "FANVUE_CLIENT_SECRET"],
      },
    ],
  },
  raisehub: {
    key: "raisehub",
    name: "RaiseHub",
    description:
      "Fundraising platform with business workspaces, partner rewards, demo/prod isolation, owner controls, and Stripe-backed commerce.",
    repoSlug: "zanibethel/raisehub",
    defaultRef: "main",
    vercelProject: {
      id: "prj_dgC022Tu2ua8xNgoBKRrenRmYAnd",
      name: "raisehub",
    },
    supabaseProjectRef: null,
    integrationHealthUrl: null,
    healthPlaybookKey: "raisehub-health-check",
    hermesPlaybookKey: "raisehub-hermes-patch",
    compatibilityTargets: [
      "linked-project",
      "provider-secret-broker",
      "vercel-sandbox",
      "supabase",
    ],
    executorPreference: [
      "deterministic-code",
      "connected-chatgpt",
      "native-cooperative",
      "hermes-cloud-operative",
    ],
    secretRequirements: [],
    humanActions: [
      {
        key: "vercel-environment",
        title: "RaiseHub environment variables",
        provider: "Vercel",
        description:
          "Open RaiseHub's Vercel environment settings for owner-gated configuration. CoOperative does not read or retain values entered in the provider window.",
        launchUrl:
          "https://vercel.com/zanibethels-projects/raisehub/settings/environment-variables",
        mode: "embedded-or-popup",
        completion: "manual-return-and-verify",
        relatedSecretKeys: [],
      },
    ],
  },
};

export function linkedProjectKeys(): LinkedProjectKey[] {
  return Object.keys(PROJECTS) as LinkedProjectKey[];
}

export function getLinkedProject(
  key: string | null | undefined,
): LinkedProjectManifest | null {
  if (!key) return null;
  return (PROJECTS as Record<string, LinkedProjectManifest | undefined>)[key] ?? null;
}

export function linkedProjects(): LinkedProjectManifest[] {
  return linkedProjectKeys().map((key) => PROJECTS[key]);
}

export function getProjectHumanAction(
  projectKey: string,
  actionKey: string,
): ProjectHumanAction | null {
  const project = getLinkedProject(projectKey);
  return project?.humanActions.find((action) => action.key === actionKey) ?? null;
}
