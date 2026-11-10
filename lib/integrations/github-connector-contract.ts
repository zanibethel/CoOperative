/**
 * Strictly typed, deterministic validation for GitHub repository tool requests.
 * Never use untrusted model-provided URLs or fetch arbitrary external hosts.
 */
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export function githubRepoSlug(value: string): { owner: string; repo: string } {
  if (!GITHUB_REPO_PATTERN.test(value)) {
    throw new Error("A repository must be specified as owner/name.");
  }
  const [owner, repo] = value.split("/");
  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === ".."
    || owner.startsWith(".") || repo.endsWith(".") || owner.endsWith(".")) {
    throw new Error("Invalid GitHub repository.");
  }
  return { owner, repo };
}

export function githubFilePath(value: string): string {
  if (!value || value.length > 350 || value.startsWith("/") || value.endsWith("/")) {
    throw new Error("Invalid repository file path.");
  }
  const segments = value.split("/");
  if (segments.some((x) => !x || x === "." || x === ".." || /[\\\u0000-\u001f]/.test(x))) {
    throw new Error("Invalid repository file path.");
  }
  return segments.map(encodeURIComponent).join("/");
}

export function githubRepoApiPath(repository: string): string {
  const { owner, repo } = githubRepoSlug(repository);
  return "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
}

export type GithubRepositorySummary = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  canRead: boolean;
  canWrite: boolean;
  installationId: number;
};
