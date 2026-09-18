export interface UsageForCost {
  estimated_cost_usd?: number;
  cost_source?: string;
  cost_status?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_including_auxiliary?: {
    estimated_cost_usd?: number;
  };
}

export interface GatewayPricing {
  input?: string;
  output?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  varies_by_provider?: boolean;
}

export interface ResolvedModelCost {
  usd: number;
  microunits: number;
  source: "hermes-usage" | "ai-gateway-catalog";
  status: "reported" | "estimated";
}

function parseUnitPrice(value: string | undefined, label: string): number {
  if (!value) {
    throw new Error("AI Gateway model catalog did not provide " + label + " pricing.");
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("AI Gateway model catalog returned invalid " + label + " pricing.");
  }

  return parsed;
}

/**
 * Resolve model cost without ever treating "unknown" as free.
 *
 * Prefer an authoritative Hermes/provider cost. If Hermes explicitly says the
 * cost is unknown, calculate a deterministic estimate from the AI Gateway
 * catalog price snapshot and the actual token counts. If the catalog cannot
 * resolve an exact price, fail closed instead of writing $0.
 */
export function resolveModelCost(
  usage: UsageForCost,
  pricing: GatewayPricing | undefined,
): ResolvedModelCost {
  const reportedUsd =
    usage.total_including_auxiliary?.estimated_cost_usd ??
    usage.estimated_cost_usd;

  const reportIsAuthoritative =
    typeof reportedUsd === "number" &&
    Number.isFinite(reportedUsd) &&
    reportedUsd >= 0 &&
    usage.cost_status !== "unknown" &&
    usage.cost_source !== "none";

  if (reportIsAuthoritative) {
    return {
      usd: reportedUsd,
      microunits: Math.ceil(reportedUsd * 1_000_000),
      source: "hermes-usage",
      status: "reported",
    };
  }

  if (!pricing) {
    throw new Error(
      "Hermes cost is unknown and AI Gateway catalog pricing is unavailable; refusing to record $0.",
    );
  }

  if (pricing.varies_by_provider) {
    throw new Error(
      "Hermes cost is unknown and AI Gateway pricing varies by provider; exact cost cannot be resolved safely.",
    );
  }

  const inputRate = parseUnitPrice(pricing.input, "input");
  const outputRate = parseUnitPrice(pricing.output, "output");
  const cacheReadRate = pricing.input_cache_read
    ? parseUnitPrice(pricing.input_cache_read, "cache-read")
    : inputRate;
  const cacheWriteRate = pricing.input_cache_write
    ? parseUnitPrice(pricing.input_cache_write, "cache-write")
    : inputRate;

  const inputTokens = Math.max(0, Number(usage.input_tokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? 0));
  const cacheReadTokens = Math.max(0, Number(usage.cache_read_tokens ?? 0));
  const cacheWriteTokens = Math.max(0, Number(usage.cache_write_tokens ?? 0));
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const rawUsd =
    uncachedInputTokens * inputRate +
    cacheReadTokens * cacheReadRate +
    cacheWriteTokens * cacheWriteRate +
    outputTokens * outputRate;
  const usd = Number(rawUsd.toFixed(12));

  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("Unable to calculate a valid AI Gateway catalog cost.");
  }

  if ((inputTokens > 0 || outputTokens > 0) && usd === 0) {
    throw new Error(
      "Model usage consumed tokens but resolved catalog cost was zero; refusing to record $0.",
    );
  }

  return {
    usd,
    microunits: Math.ceil(usd * 1_000_000),
    source: "ai-gateway-catalog",
    status: "estimated",
  };
}
