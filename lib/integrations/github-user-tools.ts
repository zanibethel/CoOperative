import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizedUserOAuthAccessToken } from "@/lib/integrations/user-oauth-token-broker";
import {
  githubRepoApiPath,
  githubFilePath,
  type GithubRepositorySummary,
} from "@/lib/integrations/github-connector-contract";

const GITHUB_API = "https://api.github.com";
const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "CoOperative-Connected-Services",
};

type Installation = {
  id: number;
  account?: { login?: string };
  permissions?: { metadata?: string; contents?: string; pull_requests?: string };
  suspended_at?: string | null;
};

type Repository = {
  full_name?: string;
  private?: boolean;
  default_branch?: string;
  html_url?: string;
  permissions?: { push?: boolean; pull?: boolean; admin?: boolean };
};

type GhPage<T> = { total_count?: number; installations?: T[]; repositories?: T[] };
type GithubPull = { number: number; title: string; state: string; draft: boolean; html_url: string };
type FileResult = {
  type?: string; size?: number; encoding?: string; content?: string; sha?: string;
  html_url?: string; path?: string;
};

export class GitHubToolError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GitHubToolError";
  }
}

/** Fixed host and paths; no redirects or arbitrary service/tool URLs. */
async function githubApi<T>(token: string, path: string): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\")
    || path.includes("?https:") || /[\u0000-\u001f]/.test(path)) {
    throw new GitHubToolError("Invalid GitHub API path.");
  }
  const response = await fetch(GITHUB_API + path, {
    method: "GET",
    headers: { ...HEADERS, Authorization: "Bearer " + token },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    // Provider response text can contain private data. Do not reflect it or the token.
    const message = response.status === 401 ? "GitHub connection expired; please reconnect."
      : response.status === 403 ? "GitHub denied access to this resource."
      : response.status === 404 ? "GitHub resource not found."
      : "GitHub request could not be completed.";
    throw new GitHubToolError(message, response.status);
  }
  return await response.json() as T;
}

/** Require a connection owned by the authenticated user; do not trust AI-supplied user IDs. */
async function githubAccountToken(userId: string, connectionId?: string): Promise<string> {
  if (connectionId) {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from("user_oauth_connections")
      .select("provider_account_id")
      .eq("id", connectionId).eq("user_id", userId)
      .eq("provider_key", "github").eq("connection_status", "connected")
      .maybeSingle();
    if (error) throw new GitHubToolError("Could not check account ownership.", 502);
    if (!data) throw new GitHubToolError("GitHub connection not found.", 404);
    return await authorizedUserOAuthAccessToken(userId, "github", data.provider_account_id);
  }
  return await authorizedUserOAuthAccessToken(userId, "github");
}

async function page<T>(
  token: string, endpoint: string, itemKey: "installations" | "repositories",
): Promise<T[]> {
  const items: T[] = [];
  for (let index = 1; index <= 5; index++) {
    const body = await githubApi<GhPage<T>>(
      token, endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=100&page=" + index,
    );
    const chunk = body[itemKey] || [];
    items.push(...chunk);
    if (chunk.length < 100) return items;
  }
  throw new GitHubToolError("GitHub returned more results than this connector can safely process.");
}

export async function githubInstalledRepositories(
  userId: string, connectionId?: string,
): Promise<GithubRepositorySummary[]> {
  const token = await githubAccountToken(userId, connectionId);
  const installations = await page<Installation>(token, "/user/installations", "installations");
  const results = new Map<string, GithubRepositorySummary>();
  for (const installation of installations) {
    if (!Number.isSafeInteger(installation.id) || installation.id < 1 || installation.suspended_at) continue;
    const repositories = await page<Repository>(
      token, "/user/installations/" + installation.id + "/repositories", "repositories",
    );
    for (const repo of repositories) {
      if (!repo.full_name || !repo.html_url || !/^https:\/\/github\.com\//.test(repo.html_url)) continue;
      const contents = installation.permissions?.contents || "none";
      const canRead = contents === "read" || contents === "write";
      const canWrite = contents === "write" && Boolean(repo.permissions?.push);
      results.set(repo.full_name.toLowerCase(), {
        fullName: repo.full_name,
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch || "main",
        url: repo.html_url,
        canRead,
        canWrite,
        installationId: installation.id,
      });
    }
  }
  return Array.from(results.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function checkedRepo(
  userId: string, repo: string, connectionId?: string,
): Promise<{ token: string; repository: GithubRepositorySummary }> {
  const apiPath = githubRepoApiPath(repo);
  const installed = await githubInstalledRepositories(userId, connectionId);
  const repository = installed.find((x) => githubRepoApiPath(x.fullName).toLowerCase() === apiPath.toLowerCase());
  if (!repository || !repository.canRead) {
    throw new GitHubToolError(
      "That repository is not available through your GitHub App installation. Install the app on the repository and grant Contents: read.",
      403,
    );
  }
  // The broker always re-verifies the current user's account. Repo permissions
  // are discovered live rather than trusted from a previously cached list.
  const token = await githubAccountToken(userId, connectionId);
  return { token, repository };
}

export async function githubRepositoryOverview(
  userId: string, repo: string, connectionId?: string,
): Promise<{ repository: GithubRepositorySummary; openPullRequests: GithubPull[] }> {
  const { token, repository } = await checkedRepo(userId, repo, connectionId);
  const path = githubRepoApiPath(repo);
  const pulls = await githubApi<GithubPull[]>(
    token, path + "/pulls?state=open&per_page=30",
  );
  return {
    repository,
    openPullRequests: pulls.slice(0, 30).map((pull) => ({
      number: pull.number, title: pull.title, state: pull.state,
      draft: pull.draft, html_url: pull.html_url,
    })),
  };
}

export async function githubReadRepositoryFile(
  userId: string, repo: string, path: string, connectionId?: string,
): Promise<{ repository: string; path: string; content: string; sha: string; url: string }> {
  const { token, repository } = await checkedRepo(userId, repo, connectionId);
  const safePath = githubFilePath(path);
  const body = await githubApi<FileResult>(
    token, githubRepoApiPath(repository.fullName) + "/contents/" + safePath +
      "?ref=" + encodeURIComponent(repository.defaultBranch),
  );
  if (body.type !== "file" || body.encoding !== "base64" || !body.content ||
    typeof body.size !== "number" || body.size > 100_000 || !body.sha) {
    throw new GitHubToolError("File is not a supported UTF-8 text file under 100 KB.");
  }
  const bytes = Buffer.from(body.content.replace(/\s/g, ""), "base64");
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { repository: repository.fullName, path, content: value, sha: body.sha,
    url: body.html_url || repository.url };
}
