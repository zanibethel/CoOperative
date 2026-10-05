import "server-only";

import {
  MICRO_USD_PER_USD,
  microusdToUsd,
  usdToMicrousd,
} from "@/lib/billing/ai-profile-balance";

const MIN_MARKUP_PERCENT = 50;
const DEFAULT_MARKUP_PERCENT = 50;
const MAX_MARKUP_PERCENT = 300;

function configuredMarkupPercent() {
  const raw = Number(process.env.COOPERATIVE_PAID_AI_MARKUP_PERCENT ?? "");
  if (!Number.isFinite(raw)) return DEFAULT_MARKUP_PERCENT;
  return Math.min(
    MAX_MARKUP_PERCENT,
    Math.max(MIN_MARKUP_PERCENT, raw),
  );
}

export type PaidAiPriceQuote = {
  providerCostEstimateUsd: number;
  providerCostEstimateMicrousd: number;
  markupPercent: number;
  markupUsd: number;
  markupMicrousd: number;
  userQuoteUsd: number;
  userQuoteMicrousd: number;
};

export function paidAiPriceQuote(providerCostEstimateUsd: number): PaidAiPriceQuote {
  const providerCostEstimateMicrousd = usdToMicrousd(providerCostEstimateUsd);
  if (!providerCostEstimateMicrousd) {
    return {
      providerCostEstimateUsd: 0,
      providerCostEstimateMicrousd: 0,
      markupPercent: configuredMarkupPercent(),
      markupUsd: 0,
      markupMicrousd: 0,
      userQuoteUsd: 0,
      userQuoteMicrousd: 0,
    };
  }

  const markupPercent = configuredMarkupPercent();
  const multiplier = 1 + markupPercent / 100;
  const userQuoteMicrousd = Math.max(
    providerCostEstimateMicrousd + 1,
    Math.ceil(providerCostEstimateMicrousd * multiplier),
  );
  const markupMicrousd =
    userQuoteMicrousd - providerCostEstimateMicrousd;

  return {
    providerCostEstimateUsd: microusdToUsd(providerCostEstimateMicrousd),
    providerCostEstimateMicrousd,
    markupPercent,
    markupUsd: microusdToUsd(markupMicrousd),
    markupMicrousd,
    userQuoteUsd: microusdToUsd(userQuoteMicrousd),
    userQuoteMicrousd,
  };
}

export function realizedPaidAiMargin(input: {
  userChargeUsd: number;
  actualProviderCostUsd: number;
}) {
  const userChargeMicrousd = usdToMicrousd(input.userChargeUsd);
  const actualProviderCostMicrousd = usdToMicrousd(input.actualProviderCostUsd);
  const marginMicrousd =
    userChargeMicrousd - actualProviderCostMicrousd;

  return {
    userChargeUsd: microusdToUsd(userChargeMicrousd),
    userChargeMicrousd,
    actualProviderCostUsd: microusdToUsd(actualProviderCostMicrousd),
    actualProviderCostMicrousd,
    marginUsd: marginMicrousd / MICRO_USD_PER_USD,
    marginMicrousd,
    profitable: marginMicrousd > 0,
  };
}
