import { NextResponse } from "next/server";

import { stripeClient } from "@/lib/billing/stripe-client";
import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session." }, { status: 400 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data: intent, error: intentError } = await admin
      .from("ai_balance_funding_intents")
      .select("id,user_id,status,topup_option_id,provider_session_id")
      .eq("provider_session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (intentError) throw intentError;
    if (!intent) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const { data: option, error: optionError } = await admin
      .from("ai_balance_topup_options")
      .select("livemode")
      .eq("id", intent.topup_option_id)
      .single();

    if (optionError) throw optionError;

    const mode = option.livemode ? "live" : "test";
    const stripe = stripeClient(mode);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return NextResponse.json(
      {
        sessionId: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        fundingStatus: intent.status,
        mode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not read Stripe Checkout status.";
    return NextResponse.json(
      {
        error: "Could not read checkout status.",
        detail: detail.slice(0, 300),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
