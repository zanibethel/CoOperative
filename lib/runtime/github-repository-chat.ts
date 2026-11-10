/** Code-first GitHub repository discovery. Never parses or executes arbitrary tool calls. */
export function githubRepositoryListIntent(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim().replace(/[?.!]$/, "");
  return /^(?:show|list|display|find|which|what|check)\b/.test(normalized)
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
