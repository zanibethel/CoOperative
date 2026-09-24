import { NextResponse } from "next/server";

import { getProviderBootstrap } from "@/lib/operative/provider-bootstrap";
import { getLinkedProject } from "@/lib/operative/project-registry";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProviderLiveStatus = {
  configured: boolean;
  reachable: boolean;
  detail: string | null;
  toolCount: number | null;
  toolNames: string[];
};

function boundedText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function providerStatusFromHealth(
  payload: unknown,
  providerKey: string,
): ProviderLiveStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const provider = (payload as Record<string, unknown>)[providerKey];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) return null;

  const record = provider as Record<string, unknown>;
  const rawToolNames = Array.isArray(record.toolNames) ? record.toolNames : [];

  return {
    configured: record.configured === true,
    reachable: record.reachable === true,
    detail: boundedText(record.detail),
    toolCount:
      typeof record.toolCount === "number" && Number.isFinite(record.toolCount)
        ? Math.max(0, Math.floor(record.toolCount))
        : null,
    toolNames: rawToolNames
      .filter((value): value is string => typeof value === "string")
      .slice(0, 50),
  };
}

function nextActionFor(status: ProviderLiveStatus | null) {
  if (status?.reachable) {
    return {
      state: "ready" as const,
      action: "continue",
      detail:
        "Provider authentication is live. CoOperative can continue with deterministic capability discovery before any paid generation.",
    };
  }

  if (status?.configured) {
    return {
      state: "verification_failed" as const,
      action: "verify",
      detail:
        "The provider credential appears configured, but the provider is not reachable. Re-verify before any generation or Hermes escalation.",
    };
  }

  return {
    state: "human_action_required" as const,
    action: "handoff",
    detail:
      "Complete the minimum provider identity/key step, then use the owner-gated secret broker. A deployment remains a separate gate before verification can become live.",
  };
}

async function liveProviderVerification(
  integrationHealthUrl: string | null,
  providerKey: string,
): Promise<{
  checked: boolean;
  status: ProviderLiveStatus | null;
  error: string | null;
}> {
  if (!integrationHealthUrl) {
    return {
      checked: false,
      status: null,
      error: "This linked project has no allow-listed integration health endpoint.",
    };
  }

  try {
    const response = await fetch(integrationHealthUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        checked: true,
        status: null,
        error: "Linked-project integration health did not return JSON.",
      };
    }

    const payload = await response.json();
    return {
      checked: true,
      status: providerStatusFromHealth(payload, providerKey),
      error: response.ok
        ? null
        : `Linked-project integration health returned ${response.status}.`,
    };
  } catch (error) {
    return {
      checked: true,
      status: null,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Unable to reach linked-project integration health.",
    };
  }
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ projectKey: string; providerKey: string }>;
  },
) {
  const { projectKey, providerKey } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = getLinkedProject(projectKey);
  if (!project) {
    return NextResponse.json({ error: "Unknown linked project." }, { status: 404 });
  }

  const bootstrap = getProviderBootstrap(projectKey, providerKey);
  if (!bootstrap) {
    return NextResponse.json(
      { error: "No reviewed provider bootstrap exists for this project/provider." },
      { status: 404 },
    );
  }

  const humanAction =
    project.humanActions.find((action) => action.key === bootstrap.humanActionKey) ??
    null;
  const secretRequirements = bootstrap.secretKeys
    .map((key) => project.secretRequirements.find((item) => item.key === key))
    .filter(Boolean);

  const verification = bootstrap.verification.projectHealth
    ? await liveProviderVerification(
        project.integrationHealthUrl,
        bootstrap.providerKey,
      )
    : { checked: false, status: null, error: null };

  const next = nextActionFor(verification.status);

  return NextResponse.json({
    projectKey,
    providerKey: bootstrap.providerKey,
    providerName: bootstrap.providerName,
    preferredAuthOrder: bootstrap.preferredAuthOrder,
    currentlySupportedAuth: bootstrap.currentlySupportedAuth,
    handoff: bootstrap.handoff,
    humanAction,
    secretRequirements,
    verification: {
      ...bootstrap.verification,
      liveChecked: verification.checked,
      liveStatus: verification.status,
      liveError: verification.error,
    },
    next,
    automatedAfterHandoff: bootstrap.automatedAfterHandoff,
    humanRequiredFor: bootstrap.humanRequiredFor,
    paidModelRequiredForBootstrap: false,
    hermesRequiredForBootstrap: false,
  });
}
