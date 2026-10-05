export type AgentKey = "repo-engineer" | "project-memory" | "debugger" | "verifier";
export type AgentTaskMode = "inspect" | "prepare_change" | "update_memory" | "verify";

export const AGENT_REGISTRY_REVISION = "2026-10-04.6";

export const AGENT_REGISTRY = {
  "repo-engineer": {
    key: "repo-engineer",
    name: "Repo Engineer",
    purpose:
      "Inspect approved repositories, prepare bounded code changes, and run deterministic checks.",
    preferredProfile: "quality",
    escalationProfile: "quality",
    modes: ["inspect", "prepare_change"],
    tools: [
      "git_status",
      "git_diff",
      "git_log",
      "repo_tree",
      "git_grep",
      "read_file",
      "write_file",
      "run_allowed_checks",
    ],
  },
  "project-memory": {
    key: "project-memory",
    name: "Project Memory",
    purpose:
      "Keep explicit project context, decisions, current state, and lessons learned up to date.",
    preferredProfile: "fast",
    escalationProfile: "quality",
    modes: ["inspect", "update_memory"],
    tools: [
      "git_status",
      "repo_tree",
      "git_grep",
      "read_file",
      "write_file",
      "run_allowed_checks",
    ],
  },
  debugger: {
    key: "debugger",
    name: "Debugger",
    purpose:
      "Trace failures from code, logs, and repository state and prepare a bounded fix when justified.",
    preferredProfile: "quality",
    escalationProfile: "quality",
    modes: ["inspect", "prepare_change"],
    tools: [
      "git_status",
      "git_diff",
      "repo_tree",
      "git_grep",
      "read_file",
      "run_allowed_checks",
      "write_file",
    ],
  },
  verifier: {
    key: "verifier",
    name: "Verifier",
    purpose:
      "Independently inspect proposed changes, checks, and requirements without modifying the repository.",
    preferredProfile: "quality",
    escalationProfile: "quality",
    modes: ["verify"],
    tools: [
      "git_status",
      "git_diff",
      "git_log",
      "repo_tree",
      "git_grep",
      "read_file",
      "run_allowed_checks",
    ],
  },
} as const;

export const AGENT_REPOSITORIES = {
  cooperative: {
    key: "cooperative",
    name: "CoOperative",
    githubRepo: "zanibethel/CoOperative",
    defaultBranch: "main",
    localDirName: "CoOperative",
    checks: ["npm run build"],
    memoryFiles: [
      "docs/ai/OWNER_PROFILE.md",
      "docs/ai/AGENT_POLICY.md",
      "docs/ai/AI_EXECUTOR_CHARTER.md",
      "docs/END-STATE-ROADMAP.md",
      "docs/ai/CURRENT_STATE.md",
      "docs/ai/DECISIONS.md",
      "docs/ai/LESSONS.md",
    ],
  },
  creatorhub: {
    key: "creatorhub",
    name: "CreatorHub",
    githubRepo: "zanibethel/CreatorHub",
    defaultBranch: "main",
    localDirName: "CreatorHub",
    checks: ["npm run build"],
    memoryFiles: [
      "docs/AI_CONTEXT.md",
      "docs/DECISIONS.md",
      "docs/CURRENT_STATE.md",
    ],
  },
} as const;

export type AgentRepositoryKey = keyof typeof AGENT_REPOSITORIES;

export function publicAgentRegistry() {
  return {
    revision: AGENT_REGISTRY_REVISION,
    agents: Object.values(AGENT_REGISTRY),
    repositories: Object.values(AGENT_REPOSITORIES),
    policy: {
      codeFirst: true,
      localAiWhenNeeded: true,
      noSurprisePaidFallback: true,
      secretsReadableByModel: false,
      destructiveActions: "blocked",
      sandboxBranches: "default-for-code-changes",
      sandboxBranchPush: "allowed-for-testing",
      sandboxBranchContinuation: true,
      branchChanges: "minimal-and-portable",
      ownerDirection: "authoritative-product-default",
      ownerUiChanges: "may-change-default-without-toggle",
      nonOwnerGeneralUiChanges: "opt-in-toggle-default-off",
      nonOwnerDefaultUserFlow: "preserve-for-unrelated-users",
      allowedUserInvokedSandboxScopes: ["auth-connections", "report-viewing"],
      nonOwnerMergePromotion: "owner-review-required",
      mergeToDefaultBranch: "explicit-owner-action-only",
      ownerReviewCadenceDays: 7,
      productionPush: "human-approval-required",
      productionDeploy: "human-approval-required",
      migrations: "human-approval-required",
    },
  };
}
