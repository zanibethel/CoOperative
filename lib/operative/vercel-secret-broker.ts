import { getVercelOidcToken } from "@vercel/oidc";

import {
  getLinkedProject,
  type LinkedProjectManifest,
  type ProjectSecretRequirement,
} from "./project-registry.ts";

const VERCEL_TEAM_ID = "team_AH72aX1BaaPucIOvrSgvpEhw";
const DEFAULT_VERCEL_ADMIN_CONNECTOR =
  "cooperative-vercel-admin/secret-broker";

function configuredConnectorUid(): string {
  return (
    process.env.COOPERATIVE_VERCEL_ADMIN_CONNECTOR?.trim() ||
    DEFAULT_VERCEL_ADMIN_CONNECTOR
  );
}

export type SecretTarget = "preview" | "production";

export class SecretBrokerSetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBrokerSetupRequiredError";
  }
}

export function getAllowedSecretRequirement(
  projectKey: string,
  key: string,
  target: SecretTarget,
): {
  project: LinkedProjectManifest;
  requirement: ProjectSecretRequirement;
} | null {
  const project = getLinkedProject(projectKey);
  if (!project) return null;

  const requirement = project.secretRequirements.find(
    (candidate) =>
      candidate.key === key && candidate.environments.includes(target),
  );
  if (!requirement) return null;

  return { project, requirement };
}

export function secretBrokerConfigured(): boolean {
  return Boolean(configuredConnectorUid());
}

/**
 * Retrieve the Vercel API credential through Vercel Connect.
 *
 * The long-lived Vercel access token lives in the owner-managed API-key
 * connector, never in CoOperative task text, the database, or Hermes context.
 * CoOperative proves its deployment identity with Vercel OIDC for each request.
 */
async function getVercelBrokerToken(): Promise<string> {
  const connector = configuredConnectorUid();

  const oidcToken = (await getVercelOidcToken())?.trim();
  if (!oidcToken) {
    throw new SecretBrokerSetupRequiredError(
      "Vercel OIDC identity is unavailable for the secret-broker request.",
    );
  }

  const response = await fetch(
    "https://api.vercel.com/v1/connect/token/" + encodeURIComponent(connector),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + oidcToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: { type: "app" },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new SecretBrokerSetupRequiredError(
      "Vercel Connect could not issue the secret-broker credential. Review the connector attachment and environment access.",
    );
  }

  const payload = (await response.json()) as { token?: unknown };
  if (typeof payload.token !== "string" || !payload.token.trim()) {
    throw new SecretBrokerSetupRequiredError(
      "Vercel Connect returned no usable secret-broker credential.",
    );
  }

  return payload.token.trim();
}

export interface ApplyProjectSecretInput {
  projectKey: string;
  key: string;
  target: SecretTarget;
  value: string;
}

async function resolveAccessibleVercelProject(
  token: string,
  project: LinkedProjectManifest,
): Promise<string> {
  const candidates = [project.vercelProject.id, project.vercelProject.name];

  for (const candidate of candidates) {
    const url = new URL(
      "https://api.vercel.com/v9/projects/" + encodeURIComponent(candidate),
    );
    url.searchParams.set("teamId", VERCEL_TEAM_ID);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      const payload = (await response.json()) as { id?: unknown };
      if (typeof payload.id === "string" && payload.id.trim()) {
        return payload.id.trim();
      }
      return candidate;
    }

    if (response.status !== 404) {
      throw new Error(
        "Vercel broker preflight failed with status " +
          response.status +
          " while checking access to " +
          project.name +
          ".",
      );
    }
  }

  throw new Error(
    "The CoOperative Vercel broker credential cannot access the linked " +
      project.name +
      " project in the configured team. The connector itself is working, but " +
      "the stored Vercel access token is likely scoped too narrowly. Replace " +
      "that stored Vercel token with one that can access the zanibethel's projects team, then retry. No secret value was sent to Vercel.",
  );
}

/**
 * Upsert one allow-listed linked-project environment value.
 *
 * Never log, return, persist, or pass the value to an AI. The value only
 * exists in this server request long enough to send it to the target Vercel
 * project's environment API.
 */
export async function applyProjectSecret(
  input: ApplyProjectSecretInput,
): Promise<{
  projectKey: string;
  key: string;
  target: SecretTarget;
  provider: "vercel";
  type: "sensitive";
}> {
  const allowed = getAllowedSecretRequirement(
    input.projectKey,
    input.key,
    input.target,
  );
  if (!allowed) {
    throw new Error("Secret request is not allow-listed for this linked project.");
  }

  if (!input.value || input.value.length > 20_000) {
    throw new Error("Secret value must be between 1 and 20,000 characters.");
  }

  const token = await getVercelBrokerToken();
  const accessibleProjectId = await resolveAccessibleVercelProject(
    token,
    allowed.project,
  );
  const url = new URL(
    "https://api.vercel.com/v10/projects/" +
      encodeURIComponent(accessibleProjectId) +
      "/env",
  );
  url.searchParams.set("teamId", VERCEL_TEAM_ID);
  url.searchParams.set("upsert", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        key: input.key,
        value: input.value,
        type: "sensitive",
        target: [input.target],
        comment: "Owner-approved CoOperative secret broker",
      },
    ]),
    cache: "no-store",
  });

  if (!response.ok) {
    let providerCode = "";
    try {
      const payload = (await response.json()) as {
        error?: { code?: unknown };
      };
      if (typeof payload.error?.code === "string") {
        providerCode = " (" + payload.error.code.slice(0, 120) + ")";
      }
    } catch {
      // Deliberately do not persist or echo provider response bodies here.
    }

    throw new Error(
      "Vercel environment write failed with status " +
        response.status +
        providerCode +
        ". No secret value was retained by CoOperative.",
    );
  }

  return {
    projectKey: allowed.project.key,
    key: input.key,
    target: input.target,
    provider: "vercel",
    type: "sensitive",
  };
}
