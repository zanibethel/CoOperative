import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const MICRO_USD_PER_USD = 1_000_000;
const RESERVATION_BUFFER = 1.2;

export type AiProfileBalance = {
  userId: string;
  balanceMicrousd: number;
  reservedMicrousd: number;
  availableMicrousd: number;
  lifetimeSpentMicrousd: number;
  availableUsd: number;
  funded: boolean;
};

function safeInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Math.max(0, Number(value));
  }
  return 0;
}

export function userIdFromAiOwnerRef(ownerRef: string) {
  const coop = /^coop-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  if (coop) return coop[1];

  const creatorHub = /^creatorhub:([0-9a-f-]{36}):[0-9a-f-]{36}$/i.exec(ownerRef);
  if (creatorHub) return creatorHub[1];

  const profile = /^profile-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  if (profile) return profile[1];

  return null;
}

export function usdToMicrousd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.ceil(value * MICRO_USD_PER_USD));
}

export function microusdToUsd(value: number) {
  return safeInteger(value) / MICRO_USD_PER_USD;
}

export async function aiProfileBalanceForUser(
  userId: string,
): Promise<AiProfileBalance> {
  const admin = createAdminSupabaseClient();

  const { error: ensureError } = await admin
    .from("ai_profile_balances")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

  if (ensureError) throw ensureError;

  const { data, error } = await admin
    .from("ai_profile_balances")
    .select(
      "user_id,balance_microusd,reserved_microusd,lifetime_spent_microusd",
    )
    .eq("user_id", userId)
    .single();

  if (error) throw error;

  const balanceMicrousd = safeInteger(data.balance_microusd);
  const reservedMicrousd = safeInteger(data.reserved_microusd);
  const availableMicrousd = Math.max(0, balanceMicrousd - reservedMicrousd);
  const lifetimeSpentMicrousd = safeInteger(data.lifetime_spent_microusd);

  return {
    userId,
    balanceMicrousd,
    reservedMicrousd,
    availableMicrousd,
    lifetimeSpentMicrousd,
    availableUsd: microusdToUsd(availableMicrousd),
    funded: availableMicrousd > 0,
  };
}

export async function aiProfileBalanceForOwnerRef(ownerRef: string) {
  const userId = userIdFromAiOwnerRef(ownerRef);
  return userId ? aiProfileBalanceForUser(userId) : null;
}

export async function reserveAiProfileFunds(input: {
  userId: string;
  estimatedCostUsd: number;
  source: string;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const estimatedMicrousd = usdToMicrousd(input.estimatedCostUsd);
  if (!estimatedMicrousd) return null;

  // Reserve a small safety buffer for token-estimation drift. Only actual
  // measured usage is settled; the unused reserve is released atomically.
  const reservedMicrousd = Math.max(
    estimatedMicrousd,
    Math.ceil(estimatedMicrousd * RESERVATION_BUFFER),
  );

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("reserve_ai_profile_balance", {
    p_user_id: input.userId,
    p_amount_microusd: reservedMicrousd,
    p_source: input.source,
    p_reference_id: input.referenceId || null,
    p_metadata: input.metadata || {},
  });

  if (error) throw error;
  if (typeof data !== "string" || !data) return null;

  return {
    id: data,
    userId: input.userId,
    estimatedMicrousd,
    reservedMicrousd,
    reservedUsd: microusdToUsd(reservedMicrousd),
  };
}

export async function settleAiProfileFunds(input: {
  reservationId: string;
  actualCostUsd: number;
  metadata?: Record<string, unknown>;
}) {
  const actualMicrousd = usdToMicrousd(input.actualCostUsd);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("settle_ai_profile_balance", {
    p_reservation_id: input.reservationId,
    p_actual_microusd: actualMicrousd,
    p_metadata: input.metadata || {},
  });
  if (error) throw error;
  return safeInteger(data);
}

export async function releaseAiProfileFunds(input: {
  reservationId: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("release_ai_profile_balance", {
    p_reservation_id: input.reservationId,
    p_metadata: input.metadata || {},
  });
  if (error) throw error;
  return safeInteger(data);
}
