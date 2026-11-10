/** Code-first GitHub repository discovery. Never parses or executes arbitrary tool calls. */
export function githubRepositoryListIntent(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim().replace(/[?.!]$/, "");
  return !/\b[a-z0-9_.-]+\/[a-z0-9_.-]+\b/.test(normalized)
    && /^(?:show|list|display|find|which|what|check)\b/.test(normalized)
    && /\bgithub\b/.test(normalized)
    && /\b(?:repos?|repositories)\b/.test(normalized)
    && normalized.length < 180;
}

export function githubReposAssistantText(
  repositories: Array<{ fullName: string; canRead: boolean; canWrite: boolean; private: boolean }>,
): string {
  const accessible = repositories.filter((repo) => repo.canRead);
  if (accessible.length === 0) {
    return "I cannot see any installed GitHub repositories for your connected account. Open /connections, connect GitHub, and install the CoOperative GitHub App on the repositories you approve. Your login alone does not grant access to every repository.";
  }
  const lines = accessible.slice(0, 30).map((repo) =>
    "- " + repo.fullName + (repo.private ? " (private)" : " (public)") +
    (repo.canWrite ? " — write access approved" : " — read-only"),
  );
  return "I can access " + accessible.length + " repository(s) through your GitHub App installation:\n\n" +
    lines.join("\n") +
    (accessible.length > 30 ? "\n\nShowing first 30. Open /connections for the complete list." : "") +
    "\n\nThese results come from your account's live GitHub App installation permissions.";
}

/** Only exact, named, read-only overview requests. Never execute an inferred write. */
export function githubRepositoryOverviewIntent(message: string): string | null {
  const normalized = message.trim().replace(/[?.!]$/, "");
  const match = normalized.match(
    /^(?:check|inspect|show)(?:\s+me)?\s+(?:(?:my|the)\s+)?(?:github\s+)?(?:repo|repository)\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s+(?:status|pull\s+requests|prs))?$/i,
  );
  return match?.[1] || null;
}

export function githubRepoOverviewAssistantText(input: {
  repository: { fullName: string; canRead: boolean; canWrite: boolean; private: boolean; url: string };
  openPullRequests: Array<{ number: number; title: string; draft: boolean }>;
}): string {
  const repo = input.repository;
  const lines = input.openPullRequests.slice(0, 20).map((pull) =>
    "- #" + pull.number + " " + pull.title.slice(0, 180) + (pull.draft ? " (draft)" : ""),
  );
  return "GitHub repository: " + repo.fullName + (repo.private ? " (private)" : " (public)") +
    "\nAccess: " + (repo.canWrite ? "installed with contents-write permission" : "contents read-only") +
    "\nOpen pull requests: " + input.openPullRequests.length +
    (lines.length ? "\n" + lines.join("\n") : "") +
    "\nThis was retrieved from your authorized GitHub App installation; no changes were made.";
}
