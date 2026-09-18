import type { CompatibilityTarget } from "./integration-compatibility-registry.ts";

export const CLOUD_PLAYBOOK_KEYS = [
  "cloud-self-check",
  "hermes-runtime-check",
  "hermes-model-smoke",
  "creatorhub-health-check",
  "raisehub-health-check",
] as const;
export type CloudPlaybookKey = (typeof CLOUD_PLAYBOOK_KEYS)[number];

export interface CloudPlaybook {
  key: CloudPlaybookKey;
  title: string;
  description: string;
  requiresShell: boolean;
  executor: "deterministic-code" | "hermes-cloud-operative";
  executionMode?: "sync" | "detached" | "workflow";
  repoSlug: string;
  gitRef?: string;
  compatibilityTargets: readonly CompatibilityTarget[];
  buildCommands: () => { cmd: string; args?: string[] }[];
}

/**
 * Small allow-listed playbook registry for the Cloud Operative bootstrap.
 *
 * Owner text never becomes shell commands. A task may only invoke commands
 * defined here (or in future reviewed/versioned playbooks).
 */
const PLAYBOOKS: Record<CloudPlaybookKey, CloudPlaybook> = {
  "cloud-self-check": {
    key: "cloud-self-check",
    title: "Cloud Operative self-check",
    description:
      "Clone the exact CoOperative revision in an isolated Vercel Sandbox, install dependencies, and run the unit tests.",
    requiresShell: true,
    executor: "deterministic-code",
    executionMode: "sync",
    repoSlug: "zanibethel/CoOperative",
    compatibilityTargets: ["cooperative-executor-contract", "supabase", "vercel-sandbox"],
    buildCommands: () => [
      { cmd: "test", args: ["-f", "package.json"] },
      { cmd: "node", args: ["--version"] },
      { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
      { cmd: "npm", args: ["test"] },
    ],
  },
  "hermes-runtime-check": {
    key: "hermes-runtime-check",
    title: "Cloud Hermes runtime check",
    description:
      "Prepare or reuse the pinned Hermes Agent v0.21.3 runtime, fork an isolated Vercel Sandbox, and verify the restored CLI with bounded version/help checks without provider credentials.",
    requiresShell: true,
    executor: "deterministic-code",
    executionMode: "workflow",
    repoSlug: "zanibethel/CoOperative",
    compatibilityTargets: [
      "cooperative-executor-contract",
      "supabase",
      "vercel-workflow",
      "vercel-sandbox",
      "hermes-agent",
    ],
    buildCommands: () => [
      {
        cmd: "bash",
        args: [
          "-lc",
          "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/v2026.9.14/scripts/install.sh -o /tmp/hermes-install.sh && bash /tmp/hermes-install.sh --skip-setup --skip-browser --skip-computer-use --non-interactive --branch v2026.9.14",
        ],
      },
      {
        cmd: "bash",
        args: [
          "-lc",
          "if [ -x \"$HOME/.local/bin/hermes\" ]; then \"$HOME/.local/bin/hermes\" --version; else /usr/local/bin/hermes --version; fi",
        ],
      },
      {
        cmd: "bash",
        args: [
          "-lc",
          "HERMES_BIN=\"$HOME/.local/bin/hermes\"; [ -x \"$HERMES_BIN\" ] || HERMES_BIN=/usr/local/bin/hermes; timeout 30s \"$HERMES_BIN\" --help > /tmp/hermes-help.txt && grep -q \"prompt-size\" /tmp/hermes-help.txt",
        ],
      },
    ],
  },
  "creatorhub-health-check": {
    key: "creatorhub-health-check",
    title: "CreatorHub deterministic health check",
    description:
      "Clone CreatorHub main, install dependencies, type-check, lint, and build without changing the repository, database, provider credentials, or production.",
    requiresShell: true,
    executor: "deterministic-code",
    executionMode: "detached",
    repoSlug: "zanibethel/CreatorHub",
    gitRef: "main",
    compatibilityTargets: [
      "linked-project",
      "provider-auth-handoff",
      "provider-secret-broker",
      "vercel-sandbox",
      "vercel-ai-gateway",
      "supabase",
    ],
    buildCommands: () => [
      { cmd: "test", args: ["-f", "package.json"] },
      { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
      { cmd: "npx", args: ["tsc", "--noEmit"] },
      { cmd: "npm", args: ["run", "lint"] },
      { cmd: "npm", args: ["run", "build"] },
    ],
  },
  "raisehub-health-check": {
    key: "raisehub-health-check",
    title: "RaiseHub deterministic health check",
    description:
      "Clone RaiseHub main, install dependencies, run tests, type-check, lint, and build without changing the repository, database, payments, or production.",
    requiresShell: true,
    executor: "deterministic-code",
    executionMode: "detached",
    repoSlug: "zanibethel/raisehub",
    gitRef: "main",
    compatibilityTargets: [
      "linked-project",
      "provider-secret-broker",
      "vercel-sandbox",
      "supabase",
    ],
    buildCommands: () => [
      { cmd: "test", args: ["-f", "package.json"] },
      { cmd: "npm", args: ["ci", "--no-audit", "--no-fund"] },
      { cmd: "npm", args: ["test"] },
      { cmd: "npx", args: ["tsc", "--noEmit"] },
      { cmd: "npm", args: ["run", "lint"] },
      { cmd: "npm", args: ["run", "build"] },
    ],
  },
  "hermes-model-smoke": {
    key: "hermes-model-smoke",
    title: "Cloud Hermes model smoke test",
    description:
      "Reuse the prepared Hermes runtime and run one bounded model-backed reasoning turn through Vercel AI Gateway using the deployment OIDC token. No persistent provider credential, shell tools, repository writes, or production changes.",
    requiresShell: true,
    executor: "hermes-cloud-operative",
    executionMode: "workflow",
    repoSlug: "zanibethel/CoOperative",
    compatibilityTargets: [
      "cooperative-executor-contract",
      "supabase",
      "vercel-workflow",
      "vercel-sandbox",
      "vercel-ai-gateway",
      "hermes-agent",
    ],
    buildCommands: () => [],
  },
};

export function getCloudPlaybook(key: string | null | undefined): CloudPlaybook | null {
  if (!key) return null;
  return (PLAYBOOKS as Record<string, CloudPlaybook | undefined>)[key] ?? null;
}

export function cloudPlaybookKeys(): CloudPlaybookKey[] {
  return [...CLOUD_PLAYBOOK_KEYS];
}
