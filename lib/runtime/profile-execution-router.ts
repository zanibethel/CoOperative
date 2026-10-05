import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { activeNodeIds } from "@/lib/unison/node-access";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type ProfileNodeRouting = "default" | "prefer-owned" | "require-node";
export type ProfileExecutionCapability = "text" | "vision";

type ResolveProfileExecutionInput = {
  admin: AdminClient;
  userId: string;
  capability: ProfileExecutionCapability;
  nodeRouting?: ProfileNodeRouting;
  requiredNodeId?: string | null;
  requireProfileNode?: boolean;
  fundedBalanceUsd?: number;
  maxSpendUsd?: number | null;
};

export type ProfileExecutionPlan = {
  capability: ProfileExecutionCapability;
  routeOrder: readonly string[];
  nodeRouting: ProfileNodeRouting;
  requiredNodeUnavailable: boolean;
  selectedNode: {
    id: string;
    displayName: string | null;
    state: string;
  } | null;
  preferredNodeId: string | null;
  targetNodeId: string | null;
  availablePaidBudgetUsd: number;
  paidEligible: boolean;
  routeReason: string;
};

type NodeRow = {
  id: string;
  display_name: string | null;
  state: string;
  capabilities: unknown;
  policy: unknown;
  last_seen_at: string | null;
};

function capabilityAllowed(node: NodeRow, capability: ProfileExecutionCapability) {
  const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
  const policy =
    node.policy && typeof node.policy === "object"
      ? (node.policy as { allowText?: unknown; allowImage?: unknown })
      : {};
  const seenAt = Date.parse(node.last_seen_at || "");

  if (
    !Number.isFinite(seenAt) ||
    seenAt < Date.now() - 90_000 ||
    node.state === "paused"
  ) {
    return false;
  }

  if (capability === "text") {
    return capabilities.includes("text_generation") && policy.allowText !== false;
  }

  return (
    (capabilities.includes("vision") ||
      capabilities.includes("image_understanding") ||
      capabilities.includes("text_vision")) &&
    policy.allowImage !== false
  );
}

function stateRank(state: string) {
  if (state === "idle") return 0;
  if (state === "online") return 1;
  if (state === "busy") return 2;
  return 9;
}

function money(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function paidFundingRequirement(input: {
  estimatedCostUsd: number;
  availableBalanceUsd: number;
  maxSpendUsd?: number | null;
}) {
  const estimatedCostUsd = money(input.estimatedCostUsd);
  const availableBalanceUsd = money(input.availableBalanceUsd);
  const maxSpendUsd =
    input.maxSpendUsd === null || input.maxSpendUsd === undefined
      ? null
      : money(input.maxSpendUsd);
  const allowedBySpendPolicy =
    maxSpendUsd === null || estimatedCostUsd <= maxSpendUsd;
  const shortfallUsd = Math.max(0, estimatedCostUsd - availableBalanceUsd);

  return {
    estimatedCostUsd,
    availableBalanceUsd,
    maxSpendUsd,
    allowedBySpendPolicy,
    sufficientBalance: shortfallUsd <= 0,
    shortfallUsd,
    minimumRequiredBalanceUsd: estimatedCostUsd,
  };
}

export async function resolveProfileExecutionPlan(
  input: ResolveProfileExecutionInput,
): Promise<ProfileExecutionPlan> {
  const nodeRouting = input.nodeRouting || "default";
  const [nodeIds, settingsResult] = await Promise.all([
    activeNodeIds(input.admin, input.userId),
    input.admin
      .from("personal_ai_settings")
      .select("preferred_node_id")
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  if (settingsResult.error) throw settingsResult.error;

  const { data: nodes, error: nodesError } =
    nodeIds.length > 0
      ? await input.admin
          .from("unison_nodes")
          .select("id,display_name,state,capabilities,policy,last_seen_at")
          .in("id", nodeIds)
          .order("last_seen_at", { ascending: false })
      : { data: [], error: null };

  if (nodesError) throw nodesError;

  const candidates = ((nodes || []) as NodeRow[])
    .filter((node) => capabilityAllowed(node, input.capability))
    .sort(
      (a, b) =>
        stateRank(a.state) - stateRank(b.state) ||
        Date.parse(b.last_seen_at || "") - Date.parse(a.last_seen_at || ""),
    );

  const requestedNodeId = input.requiredNodeId || null;
  const savedPreferredNodeId = settingsResult.data?.preferred_node_id || null;
  const selected =
    (requestedNodeId
      ? candidates.find((node) => node.id === requestedNodeId)
      : null) ||
    (savedPreferredNodeId
      ? candidates.find((node) => node.id === savedPreferredNodeId)
      : null) ||
    candidates[0] ||
    null;

  const requiresNode = nodeRouting === "require-node" || input.requireProfileNode === true;
  const requiredNodeUnavailable = requiresNode && !selected;
  const targetNodeId = requiresNode && selected ? selected.id : null;
  const preferredNodeId = !requiresNode && selected ? selected.id : null;

  const balanceUsd = money(input.fundedBalanceUsd);
  const spendCapUsd =
    input.maxSpendUsd === null || input.maxSpendUsd === undefined
      ? null
      : money(input.maxSpendUsd);
  const availablePaidBudgetUsd =
    spendCapUsd === null ? balanceUsd : Math.min(balanceUsd, spendCapUsd);
  const paidEligible =
    input.capability === "text" &&
    !requiresNode &&
    availablePaidBudgetUsd > 0;

  const selectedLabel = selected?.display_name || selected?.id || "none";
  const routeReason = requiredNodeUnavailable
    ? "No authorized healthy profile node currently satisfies the required capability."
    : selected
      ? requiresNode
        ? `Required profile node ${selectedLabel} selected for ${input.capability} execution.`
        : `Profile-matched node ${selectedLabel} is preferred before other free/paid AI routes.`
      : "No healthy profile-matched node is available; continue through other allowed free/owned routes.";

  return {
    capability: input.capability,
    routeOrder: [
      "code",
      "profile-node",
      "owned-zero-cost",
      "strict-free-community",
      "funded-paid",
    ],
    nodeRouting,
    requiredNodeUnavailable,
    selectedNode: selected
      ? {
          id: selected.id,
          displayName: selected.display_name,
          state: selected.state,
        }
      : null,
    preferredNodeId,
    targetNodeId,
    availablePaidBudgetUsd,
    paidEligible,
    routeReason,
  };
}
