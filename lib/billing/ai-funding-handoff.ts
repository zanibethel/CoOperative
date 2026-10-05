import "server-only";

import {
  aiProfileBalanceForUser,
  aiReservationRequirementUsd,
  microusdToUsd,
} from "@/lib/billing/ai-profile-balance";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export async function fundingQuoteForUser(input: {
  userId: string;
  estimatedCostUsd: number;
  maxSpendUsd?: number | null;
}) {
  const estimatedCostUsd = Math.max(0, input.estimatedCostUsd);
  const balance = await aiProfileBalanceForUser(input.userId);
  const minimumRequiredBalanceUsd =
    aiReservationRequirementUsd(estimatedCostUsd);
  const shortfallUsd = Math.max(
    0,
    minimumRequiredBalanceUsd - balance.availableUsd,
  );
  const allowedBySpendPolicy =
    input.maxSpendUsd === null ||
    input.maxSpendUsd === undefined ||
    estimatedCostUsd <= input.maxSpendUsd + 1e-9;

  const admin = createAdminSupabaseClient();
  const { data: topUpOptions, error } = await admin
    .from("ai_balance_topup_options")
    .select("id,label,amount_microusd,currency")
    .eq("active", true)
    .eq("livemode", true)
    .order("amount_microusd", { ascending: true });
  if (error) throw error;

  const options = (topUpOptions || []).map((option) => ({
    id: String(option.id),
    label: String(option.label || "Add balance"),
    amountMicrousd: Number(option.amount_microusd || 0),
    amountUsd: microusdToUsd(Number(option.amount_microusd || 0)),
    currency: String(option.currency || "usd"),
  }));
  const minimumCoveringOption =
    options.find(
      (option) =>
        option.amountUsd + balance.availableUsd >= minimumRequiredBalanceUsd,
    ) ||
    options[options.length - 1] ||
    null;

  return {
    estimatedCostUsd,
    availableBalanceUsd: balance.availableUsd,
    minimumRequiredBalanceUsd,
    shortfallUsd,
    sufficientBalance: shortfallUsd <= 1e-9,
    allowedBySpendPolicy,
    topUpOption: minimumCoveringOption,
  };
}

export function fundingDirective(input: {
  kind: "text" | "media";
  jobId: string;
  quote: Awaited<ReturnType<typeof fundingQuoteForUser>>;
}) {
  const prefix =
    input.kind === "media"
      ? "AI_MEDIA_FUNDING_REQUIRED"
      : "AI_FUNDING_REQUIRED";
  const option = input.quote.topUpOption;
  return [
    `${prefix}:${input.jobId}`,
    `ESTIMATED_USD:${input.quote.estimatedCostUsd.toFixed(6)}`,
    `AVAILABLE_USD:${input.quote.availableBalanceUsd.toFixed(6)}`,
    `MINIMUM_BALANCE_USD:${input.quote.minimumRequiredBalanceUsd.toFixed(6)}`,
    `SHORTFALL_USD:${input.quote.shortfallUsd.toFixed(6)}`,
    option ? `TOPUP_OPTION:${option.id}` : "TOPUP_OPTION:none",
    option ? `TOPUP_USD:${option.amountUsd.toFixed(6)}` : "TOPUP_USD:0",
  ].join("\n");
}
