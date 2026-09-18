export const CLOUD_PLAYBOOK_KEYS = ["cloud-self-check"] as const;
export type CloudPlaybookKey = (typeof CLOUD_PLAYBOOK_KEYS)[number];

export interface CloudPlaybook {
  key: CloudPlaybookKey;
  title: string;
  description: string;
  requiresShell: boolean;
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
    repoSlug: "zanibethel/CoOperative",
    buildCommands: () => [
      { cmd: "test", args: ["-f", "package.json"] },
      { cmd: "node", args: ["--version"] },
      { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
      { cmd: "npm", args: ["test"] },
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
