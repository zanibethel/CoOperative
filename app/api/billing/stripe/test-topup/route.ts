import { NextResponse } from "next/server";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const TEST_OPTION_ID = "stripe-test-10";

function testProfileRef(userId: string) {
  return `stripe-test:${userId}`;
}

export async function POST() {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const profileRef = testProfileRef(userId);

  try {
    const { error: balanceError } = await admin
      .from("ai_profile_balances")
      .upsert(
        { profile_ref: profileRef },
        { onConflict: "profile_ref", ignoreDuplicates: true },
      );

    if (balanceError) throw balanceError;

    const { data: option, error: optionError } = await admin
      .from("ai_balance_topup_options")
      .select(
        "id,amount_microusd,currency,provider,provider_payment_link_id,checkout_url",
      )
      .eq("id", TEST_OPTION_ID)
      .eq("provider", "stripe")
      .eq("livemode", false)
      .eq("active", true)
      .maybeSingle();

    if (optionError) throw optionError;
    if (!option) {
      return NextResponse.json(
        { error: "Stripe test top-up is not configured." },
        { status: 503 },
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
          initiatedBy: "platform-owner-test",
          isolatedTestBalance: true,
        },
      })
      .select("id")
      .single();

    if (intentError) throw intentError;

    const checkout = new URL(option.checkout_url);
    checkout.searchParams.set("client_reference_id", intent.id);

    return NextResponse.redirect(checkout.toString(), 303);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not start Stripe test.";
    console.error("Stripe isolated top-up test failed", {
      detail: detail.slice(0, 800),
    });

    return NextResponse.json(
      { error: "Could not start Stripe test." },
      { status: 500 },
    );
  }
}
