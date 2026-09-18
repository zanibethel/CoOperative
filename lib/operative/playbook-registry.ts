export const CLOUD_PLAYBOOK_KEYS = ["cloud-self-check", "hermes-runtime-check"] as const;
export type CloudPlaybookKey = (typeof CLOUD_PLAYBOOK_KEYS)[number];

export interface CloudPlaybook {
  key: CloudPlaybookKey;
  title: string;
  description: string;
  requiresShell: boolean;
  executionMode?: "sync" | "detached";
  repoSlug: string;
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
    executionMode: "sync",
    repoSlug: "zanibethel/CoOperative",
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
      "Install the pinned official Hermes Agent v0.21.3 release inside an isolated Vercel Sandbox, verify the CLI, and run an offline prompt-size check without provider credentials.",
    requiresShell: true,
    executionMode: "detached",
    repoSlug: "zanibethel/CoOperative",
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
          "HERMES_BIN=\"$HOME/.local/bin/hermes\"; [ -x \"$HERMES_BIN\" ] || HERMES_BIN=/usr/local/bin/hermes; \"$HERMES_BIN\" prompt-size --json > /tmp/hermes-prompt-size.json && test -s /tmp/hermes-prompt-size.json",
        ],
      },
    ],
  },
};

export function getCloudPlaybook(key: string | null | undefined): CloudPlaybook | null {
  if (!key) return null;
  return (PLAYBOOKS as Record<string, CloudPlaybook | undefined>)[key] ?? null;
}

export function cloudPlaybookKeys(): CloudPlaybookKey[] {
  return [...CLOUD_PLAYBOOK_KEYS];
}
