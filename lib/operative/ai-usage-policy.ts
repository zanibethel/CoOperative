export type CooperativeAiPlan = "free" | "starter" | "pro" | "owner";

export interface CooperativeAiAllowance {
  plan: CooperativeAiPlan;
  requestTokenCap: number;
  monthlyTokenCap: number;
  defaultCostCapUsd: number;
  hardCostCapUsd: number;
}

const PLAN_DEFAULTS: Record<CooperativeAiPlan, Omit<CooperativeAiAllowance, "plan">> = {
  free: {
    requestTokenCap: 1_500,
    monthlyTokenCap: 50_000,
    defaultCostCapUsd: 0.003,
    hardCostCapUsd: 0.005,
  },
  starter: {
    requestTokenCap: 2_500,
    monthlyTokenCap: 250_000,
    defaultCostCapUsd: 0.006,
    hardCostCapUsd: 0.01,
  },
  pro: {
    requestTokenCap: 5_000,
    monthlyTokenCap: 1_000_000,
    defaultCostCapUsd: 0.015,
    hardCostCapUsd: 0.03,
  },
  owner: {
    requestTokenCap: 8_000,
    monthlyTokenCap: 5_000_000,
    defaultCostCapUsd: 0.02,
    hardCostCapUsd: 0.10,
  },
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveUsd(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeAiPlan(value: unknown, isOwner: boolean): CooperativeAiPlan {
  if (isOwner) return "owner";
  return value === "starter" || value === "pro" || value === "free" ? value : "free";
}

export function getAiAllowance(plan: CooperativeAiPlan): CooperativeAiAllowance {
  const defaults = PLAN_DEFAULTS[plan];
  const prefix = "COOPERATIVE_AI_" + plan.toUpperCase();

  const hardCostCapUsd = positiveUsd(
    process.env[prefix + "_HARD_COST_USD"],
    defaults.hardCostCapUsd,
  );
  const defaultCostCapUsd = Math.min(
    hardCostCapUsd,
    positiveUsd(process.env[prefix + "_DEFAULT_COST_USD"], defaults.defaultCostCapUsd),
  );

  return {
    plan,
    requestTokenCap: positiveInteger(
      process.env[prefix + "_REQUEST_TOKENS"],
      defaults.requestTokenCap,
    ),
    monthlyTokenCap: positiveInteger(
      process.env[prefix + "_MONTHLY_TOKENS"],
      defaults.monthlyTokenCap,
    ),
    defaultCostCapUsd,
    hardCostCapUsd,
  };
}

export function clampRequestedCostCap(
  requestedUsd: unknown,
  allowance: CooperativeAiAllowance,
  canManageLimits: boolean,
) {
  if (!canManageLimits) return allowance.defaultCostCapUsd;

  const requested = Number(requestedUsd);
  if (!Number.isFinite(requested) || requested <= 0) {
    return allowance.defaultCostCapUsd;
  }

  return Math.min(requested, allowance.hardCostCapUsd);
}

/**
 * Deliberately conservative preflight estimate. It is only used to shrink the
 * request before the provider call; actual provider token counts are recorded
 * after the response.
 */
export function estimatePromptTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function parseLedgerTokenUsage(notes: string | null | undefined) {
  if (!notes) return 0;

  try {
    const parsed = JSON.parse(notes) as {
      kind?: unknown;
      totalTokens?: unknown;
    };
    if (parsed.kind !== "console-ask-ai") return 0;
    const total = Number(parsed.totalTokens);
    return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  } catch {
    return 0;
  }
}
