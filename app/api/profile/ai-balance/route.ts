import { NextResponse } from "next/server";
import { z } from "zod";

import {
  aiProfileBalanceForUser,
  cooperativeProfileRef,
  microusdToUsd,
} from "@/lib/billing/ai-profile-balance";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const topUpSchema = z.object({
  topUpOptionId: z.string().min(1).max(80),
});

function ledgerLabel(source: string, kind: string) {
  if (source === "stripe-balance-topup") return "Balance top-up";
  if (source === "local-chat-paid-fallback") return "High-quality AI fallback";
  if (source === "agent-paid-llm") return "Paid AI task";
  if (kind === "credit") return "Balance credit";
  if (kind === "debit") return "Paid AI usage";
  return "Balance adjustment";
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const balance = await aiProfileBalanceForUser(userId);
    const admin = createAdminSupabaseClient();

    const [{ data: options, error: optionsError }, { data: ledger, error: ledgerError }] =
      await Promise.all([
        admin
          .from("ai_balance_topup_options")
          .select("id,label,amount_microusd,currency")
          .eq("active", true)
          .eq("livemode", true)
          .order("sort_order", { ascending: true }),
        admin
          .from("ai_profile_balance_ledger")
          .select("id,kind,amount_microusd,source,created_at")
          .eq("profile_ref", balance.profileRef)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

    if (optionsError) throw optionsError;
    if (ledgerError) throw ledgerError;

    return NextResponse.json(
      {
        balanceMicrousd: balance.balanceMicrousd,
        reservedMicrousd: balance.reservedMicrousd,
        availableMicrousd: balance.availableMicrousd,
        availableUsd: balance.availableUsd,
        lifetimeSpentMicrousd: balance.lifetimeSpentMicrousd,
        lifetimeSpentUsd: microusdToUsd(balance.lifetimeSpentMicrousd),
        funded: balance.funded,
        paidAiEligible: balance.funded,
        topUpOptions: (options || []).map((option) => ({
          id: option.id,
          label: option.label,
          amountMicrousd: Number(option.amount_microusd || 0),
          amountUsd: microusdToUsd(Number(option.amount_microusd || 0)),
          currency: option.currency,
        })),
        ledger: (ledger || []).map((entry) => ({
          id: String(entry.id),
          kind: entry.kind,
          source: entry.source,
          label: ledgerLabel(entry.source, entry.kind),
          amountMicrousd: Number(entry.amount_microusd || 0),
          amountUsd:
            Math.abs(Number(entry.amount_microusd || 0)) / 1_000_000,
          createdAt: entry.created_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read AI balance.";
    return NextResponse.json(
      { error: "Could not read AI balance.", detail: detail.slice(0, 500) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = topUpSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const profileRef = cooperativeProfileRef(userId);

    await aiProfileBalanceForUser(userId);

    const { data: option, error: optionError } = await admin
      .from("ai_balance_topup_options")
      .select(
        "id,label,amount_microusd,currency,provider,provider_payment_link_id,checkout_url,livemode,active",
      )
      .eq("id", input.topUpOptionId)
      .eq("active", true)
      .eq("livemode", true)
      .maybeSingle();

    if (optionError) throw optionError;
    if (!option) {
      return NextResponse.json(
        { error: "That balance top-up option is unavailable." },
        { status: 404 },
      );
    }

    const { data: intent, error: intentError } = await admin
      .from("ai_balance_funding_intents")
      .insert({
        user_id: userId,
        profile_ref: profileRef,
        topup_option_id: option.id,
        amount_microusd: option.amount_microusd,
        currency: option.currency,
        provider: option.provider,
        provider_payment_link_id: option.provider_payment_link_id,
        metadata: {
          initiatedBy: "authenticated-user",
        },
      })
      .select("id")
      .single();

    if (intentError) throw intentError;

    const checkout = new URL(option.checkout_url);
    checkout.searchParams.set("client_reference_id", intent.id);

    return NextResponse.json(
      {
        fundingIntentId: intent.id,
        amountMicrousd: Number(option.amount_microusd),
        amountUsd: microusdToUsd(Number(option.amount_microusd)),
        checkoutUrl: checkout.toString(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not start balance top-up.";
    return NextResponse.json(
      { error: "Could not start balance top-up.", detail: detail.slice(0, 500) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
