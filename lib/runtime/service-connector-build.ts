import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { ServiceConnectIntent } from "@/lib/runtime/service-connect-intent";
import { canAccessMainCooperative } from "@/lib/ai/main-cooperative-access";

type BuildIntent = Extract<ServiceConnectIntent, { type: "build-required" }>;

function connectorObjective(intent: BuildIntent) {
  return [
    `Prepare a reusable CoOperative third-party connector for ${intent.providerName} (${intent.providerKey}).`,
    "",
    "Goal:",
    "- Make future connection requests deterministic/code-first.",
    "- Research the provider's current public developer/API/OAuth documentation.",
    "- Prefer OAuth/OIDC when the provider supports user authorization; otherwise use the provider's supported secure credential method.",
    "- Implement the smallest reusable connector contract needed by CoOperative Chat and Connected Services.",
    "- Keep authorization, token exchange/refresh, status checks, and supported provider actions in code.",
    "- Add/update the shared connector registry only after the implementation is verified.",
    "",
    "Security and authority boundaries:",
    "- Do not request, read, copy, infer, or store any user's provider password, API key, OAuth code, access token, refresh token, cookie, or secret while building the connector.",
    "- Never send credentials or provider authorization state to an AI model.",
    "- Do not authorize an account on the user's behalf.",
    "- Do not weaken RLS, authentication, credential-vault rules, or provider scopes.",
    "- Request the minimum provider scopes necessary and document each scope.",
    "- Do not merge, deploy, change production secrets, or promote the connector automatically.",
    "",
    "Delivery:",
    "- Prepare the change on an isolated branch/worktree.",
    "- Include implementation, tests/verification, required environment variables or developer-app setup, scope list, failure/reconnect behavior, and risks.",
    "- Return the diff/branch and verification evidence for owner review.",
    "- If the provider does not expose a supported integration path, document that clearly instead of inventing one.",
  ].join("\n");
}

export async function queueConnectorBuild(input: {
  userId: string;
  ownerRef: string;
  conversationId: string;
  intent: BuildIntent;
}) {
  const admin = createAdminSupabaseClient();
  const objective = connectorObjective(input.intent);

  const { data: existing, error: existingError } = await admin
    .from("agent_tasks")
    .select("id,status,branch_name,result,error,created_at,updated_at")
    .eq("owner_ref", input.ownerRef)
    .eq("repo_key", "cooperative")
    .eq("agent_key", "repo-engineer")
    .eq("mode", "prepare_change")
    .eq("objective", objective)
    .in("status", ["queued", "claimed", "running", "waiting_llm", "needs_approval", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    return {
      taskId: existing.id as string,
      status: existing.status as string,
      reused: true,
    };
  }

  const { data: provider, error: providerError } = await admin
    .from("service_providers")
    .select("provider_key,connection_status")
    .eq("provider_key", input.intent.providerKey)
    .maybeSingle();
  if (providerError) throw providerError;

  if (!provider) {
    const { error: insertProviderError } = await admin
      .from("service_providers")
      .insert({
        provider_key: input.intent.providerKey,
        name: input.intent.providerName.slice(0, 120),
        category: "other",
        connection_method:
          input.intent.kind === "oauth" || input.intent.kind === "api-key"
            ? input.intent.kind === "api-key"
              ? "api"
              : "oauth"
            : "guided",
        connection_status: "research",
        native_replacement_status: "none",
        visibility: "public",
        notes:
          "Discovered through a conversational connection request. Connector implementation is pending review and verification.",
      });
    if (insertProviderError) throw insertProviderError;
  }

  const taskId = crypto.randomUUID();
  const ownerAuthoritative = await canAccessMainCooperative(input.userId);
  const { error: taskError } = await admin.from("agent_tasks").insert({
    id: taskId,
    owner_ref: input.ownerRef,
    agent_key: "repo-engineer",
    repo_key: "cooperative",
    mode: "prepare_change",
    objective,
    requested_profile: "quality",
    status: "queued",
    result: {
      kind: "service_connector_build",
      providerKey: input.intent.providerKey,
      providerName: input.intent.providerName,
      connectionSource: input.intent.source,
      conversationId: input.conversationId,
      promotionTarget: "shared-code-registry",
      credentialAccessAllowed: false,
      autoMergeAllowed: false,
      autoDeployAllowed: false,
      governance: {
        authority: ownerAuthoritative ? "platform-owner" : "standard-user",
        ownerAuthoritative,
        uiToggleRequired: !ownerAuthoritative,
        ownerReviewRequired: !ownerAuthoritative,
      },
    },
  });
  if (taskError) throw taskError;

  await admin.from("agent_task_events").insert({
    task_id: taskId,
    owner_ref: input.ownerRef,
    kind: "connector_build_queued",
    message: `Missing connector for ${input.intent.providerName} queued for bounded preparation.`,
    metadata: {
      providerKey: input.intent.providerKey,
      providerName: input.intent.providerName,
      conversationId: input.conversationId,
      credentialAccessAllowed: false,
      promotionTarget: "shared-code-registry",
      governanceAuthority: ownerAuthoritative ? "platform-owner" : "standard-user",
    },
  });

  return { taskId, status: "queued", reused: false };
}

export function connectorBuildAssistantMessage(input: {
  intent: BuildIntent;
  taskId: string;
  reused: boolean;
}) {
  const intro = input.reused
    ? `CoOperative already has a connector-build task for ${input.intent.providerName}.`
    : `CoOperative does not have an approved ${input.intent.providerName} connector yet, so I created a connector-build task.`;

  return [
    intro,
    "",
    "AI is being used only to research and prepare the missing reusable connector. It will not receive your credentials or sign in as you. The connector has to be implemented, verified, and reviewed before it can be promoted into the shared code-first registry for everyone.",
    "",
    `CONNECTOR_BUILD_STATUS:${input.taskId}`,
  ].join("\n");
}
