import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import {
  githubInstalledRepositories, githubReadRepositoryFile,
  githubRepositoryOverview, GitHubToolError,
} from "@/lib/integrations/github-user-tools";

export const runtime = "nodejs";
export const maxDuration = 30;

function json(data: object, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

const idSchema = z.string().uuid();

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "repositories";
  const rawConnectionId = url.searchParams.get("connectionId");
  const connectionId = rawConnectionId && idSchema.safeParse(rawConnectionId).success
    ? rawConnectionId : undefined;
  if (rawConnectionId && !connectionId) return json({ error: "Invalid connection." }, 400);
  try {
    if (mode === "setup") {
      const slug = process.env.COOP_GITHUB_APP_SLUG || "";
      const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
      return json({
        installationUrl: valid
          ? "https://github.com/apps/" + slug + "/installations/new"
          : null,
        requiresAppSetup: !valid,
      });
    }
    if (mode === "repositories") {
      const repositories = await githubInstalledRepositories(userId, connectionId);
      return json({ repositories, total: repositories.length });
    }
    const repository = url.searchParams.get("repo") || "";
    if (mode === "overview") {
      return json(await githubRepositoryOverview(userId, repository, connectionId));
    }
    if (mode === "file") {
      return json(await githubReadRepositoryFile(
        userId, repository, url.searchParams.get("path") || "", connectionId,
      ));
    }
    return json({ error: "Unknown GitHub tool." }, 400);
  } catch (error) {
    if (error instanceof GitHubToolError) {
      return json({ error: error.message }, error.status >= 500 ? 502 : error.status);
    }
    const message = error instanceof Error ? error.message : "Could not query GitHub.";
    // Preserve actionable account errors but not provider payloads or arbitrary exceptions.
    return json({ error: /connect|account|authorization|refresh/i.test(message)
      ? "Connect or reauthorize your GitHub account, then retry."
      : "Could not load GitHub repository data." }, 502);
  }
}
