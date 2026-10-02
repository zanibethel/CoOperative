import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type StripeCheckoutSession = {
  id?: string;
  client_reference_id?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_link?: string | null;
  payment_intent?: string | null;
};

type StripeEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: {
    object?: StripeCheckoutSession;
  };
};

function parseSignatureHeader(value: string) {
  const parts = value.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, rawValue] = part.trim().split("=", 2);
    if (key === "t" && rawValue) timestamp = rawValue;
    if (key === "v1" && rawValue) signatures.push(rawValue);
  }

  return { timestamp, signatures };
}

function verifyStripeSignature(rawBody: string, header: string, secret: string) {
  const parsed = parseSignatureHeader(header);
  const timestampNumber = Number(parsed.timestamp);

  if (
    !parsed.timestamp ||
    !Number.isFinite(timestampNumber) ||
    parsed.signatures.length === 0
  ) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampNumber);
  if (ageSeconds > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");

  return parsed.signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "utf8");
    return (
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)
    );
  });
}

function microusdFromStripeAmount(amountTotal: number) {
  // Stripe USD amounts are cents; one cent is 10,000 micro-USD.
  return Math.max(0, Math.trunc(amountTotal)) * 10_000;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  const admin = createAdminSupabaseClient();

  try {
    const { data: secretRow, error: secretError } = await admin
      .from("billing_provider_secrets")
      .select("secret_value")
      .eq("provider", "stripe")
      .eq("secret_kind", "webhook_signing_secret_live")
      .maybeSingle();

    if (secretError) throw secretError;
    if (!secretRow?.secret_value) {
      return NextResponse.json(
        { error: "Stripe webhook is not configured." },
        { status: 503 },
      );
    }

    if (!verifyStripeSignature(rawBody, signature, secretRow.secret_value)) {
      return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    if (event.livemode !== true) {
      return NextResponse.json({ received: true, ignored: "non-live event" });
    }

    const session = event.data?.object;
    if (!session?.id || !session.client_reference_id) {
      return NextResponse.json({ received: true, ignored: "unrelated session" });
    }

    if (event.type === "checkout.session.expired") {
      const { error } = await admin.rpc("expire_ai_balance_topup", {
        p_intent_id: session.client_reference_id,
        p_provider_session_id: session.id,
        p_metadata: {
          stripeEventId: event.id || null,
          stripeEventType: event.type,
        },
      });
      if (error) throw error;

      return NextResponse.json({ received: true });
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return NextResponse.json({ received: true, ignored: "event type" });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true, pending: true });
    }

    if (
      typeof session.amount_total !== "number" ||
      session.amount_total <= 0 ||
      session.currency?.toLowerCase() !== "usd" ||
      !session.payment_link
    ) {
      return NextResponse.json(
        { error: "Stripe session is missing required payment fields." },
        { status: 400 },
      );
    }

    const amountMicrousd = microusdFromStripeAmount(session.amount_total);

    const { data: availableMicrousd, error } = await admin.rpc(
      "complete_ai_balance_topup",
      {
        p_intent_id: session.client_reference_id,
        p_amount_microusd: amountMicrousd,
        p_provider_session_id: session.id,
        p_provider_payment_intent_id: session.payment_intent || null,
        p_provider_payment_link_id: session.payment_link,
        p_metadata: {
          stripeEventId: event.id || null,
          stripeEventType: event.type,
        },
      },
    );

    if (error) throw error;

    return NextResponse.json({
      received: true,
      credited: true,
      availableMicrousd: Number(availableMicrousd || 0),
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not process Stripe webhook.";
    console.error("AI balance Stripe webhook failed", { detail: detail.slice(0, 800) });

    return NextResponse.json(
      { error: "Could not process Stripe webhook." },
      { status: 500 },
    );
  }
}
