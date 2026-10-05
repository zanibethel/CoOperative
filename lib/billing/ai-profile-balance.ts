import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const MICRO_USD_PER_USD = 1_000_000;
export const AI_RESERVATION_BUFFER = 1.2;

export type AiProfileBalance = {
  profileRef: string;
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

export function cooperativeProfileRef(userId: string) {
  return `coop-user:${userId}`;
}

export function profileRefFromAiOwnerRef(ownerRef: string) {
  const coop = /^coop-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  if (coop) return cooperativeProfileRef(coop[1]);

  const creatorHub = /^creatorhub:([^:]{1,120}):[0-9a-f-]{36}$/i.exec(ownerRef);
  if (creatorHub) return `creatorhub-user:${creatorHub[1]}`.slice(0, 200);

  const profile = /^profile-user:([^:]{1,180})$/i.exec(ownerRef);
  if (profile) return `profile-user:${profile[1]}`.slice(0, 200);

  return null;
}

export function usdToMicrousd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.ceil(value * MICRO_USD_PER_USD));
}

export function microusdToUsd(value: number) {
  return safeInteger(value) / MICRO_USD_PER_USD;
}

export function aiReservationRequirementMicrousd(estimatedCostUsd: number) {
  const estimatedMicrousd = usdToMicrousd(estimatedCostUsd);
  if (!estimatedMicrousd) return 0;
  return Math.max(
    estimatedMicrousd,
    Math.ceil(estimatedMicrousd * AI_RESERVATION_BUFFER),
  );
}

export function aiReservationRequirementUsd(estimatedCostUsd: number) {
  return microusdToUsd(aiReservationRequirementMicrousd(estimatedCostUsd));
}

export async function aiProfileBalanceForProfileRef(
  profileRef: string,
): Promise<AiProfileBalance> {
  const normalized = profileRef.trim().slice(0, 200);
  if (!normalized) throw new Error("Profile reference is required.");

  const admin = createAdminSupabaseClient();

  const { error: ensureError } = await admin
    .from("ai_profile_balances")
    .upsert(
      { profile_ref: normalized },
      { onConflict: "profile_ref", ignoreDuplicates: true },
    );

  if (ensureError) throw ensureError;

  const { data, error } = await admin
    .from("ai_profile_balances")
    .select(
      "profile_ref,balance_microusd,reserved_microusd,lifetime_spent_microusd",
    )
    .eq("profile_ref", normalized)
    .single();

  if (error) throw error;

  const balanceMicrousd = safeInteger(data.balance_microusd);
  const reservedMicrousd = safeInteger(data.reserved_microusd);
  const availableMicrousd = Math.max(0, balanceMicrousd - reservedMicrousd);
  const lifetimeSpentMicrousd = safeInteger(data.lifetime_spent_microusd);

  return {
    profileRef: normalized,
    balanceMicrousd,
    reservedMicrousd,
    availableMicrousd,
    lifetimeSpentMicrousd,
    availableUsd: microusdToUsd(availableMicrousd),
    funded: availableMicrousd > 0,
  };
}

export async function aiProfileBalanceForUser(userId: string) {
  return aiProfileBalanceForProfileRef(cooperativeProfileRef(userId));
}

export async function aiProfileBalanceForOwnerRef(ownerRef: string) {
  const profileRef = profileRefFromAiOwnerRef(ownerRef);
  return profileRef ? aiProfileBalanceForProfileRef(profileRef) : null;
}

export async function reserveAiProfileFunds(input: {
  profileRef: string;
  estimatedCostUsd: number;
  source: string;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const estimatedMicrousd = usdToMicrousd(input.estimatedCostUsd);
  if (!estimatedMicrousd) return null;

  // Reserve a small safety buffer for estimation drift. Only actual measured
  // or quoted usage is settled; the unused reserve is released atomically.
  const reservedMicrousd = aiReservationRequirementMicrousd(
    input.estimatedCostUsd,
  );

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("reserve_ai_profile_balance", {
    p_profile_ref: input.profileRef,
    p_amount_microusd: reservedMicrousd,
    p_source: input.source,
    p_reference_id: input.referenceId || null,
    p_metadata: input.metadata || {},
  });

  if (error) throw error;
  if (typeof data !== "string" || !data) return null;

  return {
    id: data,
    profileRef: input.profileRef,
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
