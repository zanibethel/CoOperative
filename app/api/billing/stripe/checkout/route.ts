import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cooperativeProfileRef,
} from "@/lib/billing/ai-profile-balance";
import {
  stripeClient,
  stripePublishableKey,
  type CooperativeStripeMode,
} from "@/lib/billing/stripe-client";
import { canAccessMainCooperative } from "@/lib/ai/main-cooperative-access";
import { authenticatedIdentity } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const inputSchema = z.object({
  topUpOptionId: z.string().min(1).max(80),
});

function integrationIdentifier() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `cooperative_balance_${suffix}`;
}

function testProfileRef(userId: string) {
  return `stripe-test:${userId}`;
}

export async function POST(request: Request) {
  const identity = await authenticatedIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  let fundingIntentId: string | null = null;

  try {
    const input = inputSchema.parse(await request.json());

    const { data: option, error: optionError } = await admin
      .from("ai_balance_topup_options")
      .select(
        "id,label,amount_microusd,currency,provider,provider_price_id,livemode,active",
      )
      .eq("id", input.topUpOptionId)
      .eq("provider", "stripe")
      .eq("active", true)
      .maybeSingle();

    if (optionError) throw optionError;
    if (!option) {
      return NextResponse.json(
        { error: "That balance top-up option is unavailable." },
        { status: 404 },
      );
    }

    if (option.currency !== "USD") {
      return NextResponse.json(
        { error: "Only USD balance top-ups are currently supported." },
        { status: 400 },
      );
    }

    if (
      typeof option.provider_price_id !== "string" ||
      !option.provider_price_id.startsWith("price_")
    ) {
      return NextResponse.json(
        { error: "That balance top-up option is not configured in Stripe." },
        { status: 503 },
      );
    }

    const amountMicrousd = Number(option.amount_microusd || 0);
    if (
      !Number.isSafeInteger(amountMicrousd) ||
      amountMicrousd <= 0 ||
      amountMicrousd % 10_000 !== 0
    ) {
      return NextResponse.json(
        { error: "That balance top-up amount is invalid." },
        { status: 400 },
      );
    }

    const mode: CooperativeStripeMode = option.livemode ? "live" : "test";
    if (
      mode === "test" &&
      !(await canAccessMainCooperative(identity.userId))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profileRef =
      mode === "live"
        ? cooperativeProfileRef(identity.userId)
        : testProfileRef(identity.userId);

    const { error: balanceError } = await admin
      .from("ai_profile_balances")
      .upsert(
        { profile_ref: profileRef },
        { onConflict: "profile_ref", ignoreDuplicates: true },
      );

    if (balanceError) throw balanceError;

    const { data: intent, error: intentError } = await admin
      .from("ai_balance_funding_intents")
      .insert({
        user_id: identity.userId,
        profile_ref: profileRef,
        topup_option_id: option.id,
        amount_microusd: amountMicrousd,
        currency: option.currency,
        provider: "stripe",
        provider_payment_link_id: null,
        metadata: {
          initiatedBy:
            mode === "live"
              ? "authenticated-user-elements"
              : "platform-owner-elements-test",
          checkoutMode: "elements",
          livemode: option.livemode,
          stripePriceId: option.provider_price_id,
        },
      })
      .select("id")
      .single();

    if (intentError) throw intentError;
    fundingIntentId = intent.id;

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      "https://cooperative.chat";
    const returnPath =
      mode === "live" ? "/balance" : "/balance/stripe-test";
    const returnUrl =
      `${siteUrl}${returnPath}?checkout=return&session_id={CHECKOUT_SESSION_ID}`;

    const stripe = stripeClient(mode);
    const session = await stripe.checkout.sessions.create({
      ui_mode: "elements",
      mode: "payment",
      return_url: returnUrl,
      customer_email: identity.email || undefined,
      client_reference_id: intent.id,
      integration_identifier: integrationIdentifier(),
      line_items: [
        {
          quantity: 1,
          price: option.provider_price_id,
        },
      ],
      metadata: {
        cooperative_purpose: "ai-balance-topup",
        cooperative_checkout_mode: "elements",
        cooperative_funding_intent_id: intent.id,
        cooperative_topup_option_id: option.id,
        cooperative_profile_ref: profileRef,
      },
      payment_intent_data: {
        metadata: {
          cooperative_purpose: "ai-balance-topup",
          cooperative_funding_intent_id: intent.id,
          cooperative_topup_option_id: option.id,
        },
      },
    });

    if (!session.client_secret) {
      throw new Error("Stripe did not return a Checkout client secret.");
    }

    const expectedCents = amountMicrousd / 10_000;
    if (session.currency !== "usd" || session.amount_total !== expectedCents) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      throw new Error("Stripe price does not match the configured top-up amount.");
    }

    const { error: sessionSaveError } = await admin
      .from("ai_balance_funding_intents")
      .update({
        provider_session_id: session.id,
        metadata: {
          initiatedBy:
            mode === "live"
              ? "authenticated-user-elements"
              : "platform-owner-elements-test",
          checkoutMode: "elements",
          livemode: option.livemode,
          stripeSessionCreated: true,
          stripePriceId: option.provider_price_id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", intent.id)
      .eq("status", "pending");

    if (sessionSaveError) throw sessionSaveError;

    return NextResponse.json(
      {
        clientSecret: session.client_secret,
        publishableKey: stripePublishableKey(mode),
        sessionId: session.id,
        fundingIntentId: intent.id,
        amountUsd: amountMicrousd / 1_000_000,
        mode,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (fundingIntentId) {
      await admin
        .from("ai_balance_funding_intents")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fundingIntentId)
        .eq("status", "pending");
    }

    const detail =
      error instanceof Error
        ? error.message
        : "Could not start Stripe Checkout.";
    console.error("Stripe Checkout Session creation failed", {
      detail: detail.slice(0, 800),
    });

    return NextResponse.json(
      {
        error: "Could not start secure checkout.",
        detail: detail.slice(0, 300),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
