/**
 * Fail-closed financial policy for platform-funded model calls.
 * Provider quotes must be obtained from a verified, current pricing source.
 * Registry scans and configured fallback prices are not authoritative quotes.
 */
export type VerifiedPriceQuote = {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  verifiedAt: string;
  source: string;
};
export type PaidExecutionQuote = {
  providerCostCeilingUsd: number;
  customerChargeCeilingUsd: number;
  marginFraction: number;
  priceVerifiedAt: string;
  priceSource: string;
};
function finiteNonnegative(n: number) {
  return Number.isFinite(n) && n >= 0;
}
export function quotePaidExecution(input: {
  quote: VerifiedPriceQuote;
  model: string;
  provider: string;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  minimumMarginFraction: number;
  approvedCustomerBudgetUsd: number;
  now?: Date;
  maximumQuoteAgeMs?: number;
}): PaidExecutionQuote {
  const { quote } = input;
  const now = input.now ?? new Date();
  const age = now.getTime() - new Date(quote.verifiedAt).getTime();
  if (
    quote.provider !== input.provider || quote.model !== input.model ||
    !quote.source.trim() || !Number.isFinite(age) || age < 0 ||
    age > (input.maximumQuoteAgeMs ?? 60_000)
  ) throw new Error("Verified provider pricing is unavailable or stale.");
  if (
    !finiteNonnegative(quote.inputUsdPerMillion) ||
    !finiteNonnegative(quote.outputUsdPerMillion) ||
    !Number.isSafeInteger(input.maximumInputTokens) || input.maximumInputTokens < 1 ||
    !Number.isSafeInteger(input.maximumOutputTokens) || input.maximumOutputTokens < 1 ||
    !Number.isFinite(input.minimumMarginFraction) ||
    input.minimumMarginFraction < 0 || input.minimumMarginFraction >= 1 ||
    !finiteNonnegative(input.approvedCustomerBudgetUsd)
  ) throw new Error("Invalid financial guard parameters.");
  const providerCostCeilingUsd = (
    input.maximumInputTokens * quote.inputUsdPerMillion +
    input.maximumOutputTokens * quote.outputUsdPerMillion
  ) / 1_000_000;
  const customerChargeCeilingUsd = Math.ceil(
    providerCostCeilingUsd / (1 - input.minimumMarginFraction) * 1_000_000
  ) / 1_000_000;
  if (!Number.isFinite(customerChargeCeilingUsd) ||
      customerChargeCeilingUsd > input.approvedCustomerBudgetUsd) {
    throw new Error("Paid execution exceeds the approved budget or margin floor.");
  }
  return {
    providerCostCeilingUsd,
    customerChargeCeilingUsd,
    marginFraction: input.minimumMarginFraction,
    priceVerifiedAt: quote.verifiedAt,
    priceSource: quote.source,
  };
}
export function reconcilePaidExecution(input: {
  quote: VerifiedPriceQuote;
  promptTokens: number;
  outputTokens: number;
  providerBilledCostUsd?: number;
  customerChargedUsd: number;
  minimumMarginFraction: number;
}) {
  if (![input.promptTokens, input.outputTokens].every(
    n => Number.isSafeInteger(n) && n >= 0
  )) throw new Error("Invalid measured usage.");
  const calculatedProviderCostUsd = (
    input.promptTokens * input.quote.inputUsdPerMillion +
    input.outputTokens * input.quote.outputUsdPerMillion
  ) / 1_000_000;
  const reported = input.providerBilledCostUsd;
  if (reported !== undefined && !finiteNonnegative(reported))
    throw new Error("Invalid provider billed cost.");
  if (!finiteNonnegative(input.customerChargedUsd) ||
      !Number.isFinite(input.minimumMarginFraction) ||
      input.minimumMarginFraction < 0 || input.minimumMarginFraction >= 1)
    throw new Error("Invalid settlement parameters.");
  const providerCostUsd = reported ?? calculatedProviderCostUsd;
  const realizedMarginFraction = input.customerChargedUsd > 0
    ? (input.customerChargedUsd - providerCostUsd) / input.customerChargedUsd
    : (providerCostUsd === 0 ? 1 : -Infinity);
  return {
    calculatedProviderCostUsd,
    providerBilledCostUsd: reported ?? null,
    providerCostUsd,
    customerChargedUsd: input.customerChargedUsd,
    realizedMarginFraction,
    marginViolation: realizedMarginFraction + 1e-9 < input.minimumMarginFraction,
    requiresInvoiceReconciliation: reported === undefined,
  };
}
