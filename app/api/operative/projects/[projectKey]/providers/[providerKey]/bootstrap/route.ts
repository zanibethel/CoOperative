import { NextResponse } from "next/server";

import { getProviderBootstrap } from "@/lib/operative/provider-bootstrap";
import { getLinkedProject } from "@/lib/operative/project-registry";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({
    projectKey,
    providerKey: bootstrap.providerKey,
    providerName: bootstrap.providerName,
    preferredAuthOrder: bootstrap.preferredAuthOrder,
    currentlySupportedAuth: bootstrap.currentlySupportedAuth,
    humanAction,
    secretRequirements,
    verification: bootstrap.verification,
    automatedAfterHandoff: bootstrap.automatedAfterHandoff,
    humanRequiredFor: bootstrap.humanRequiredFor,
    paidModelRequiredForBootstrap: false,
    hermesRequiredForBootstrap: false,
  });
}
