import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type StripeIdLike =
  | string
  | {
      id?: string | null;
    }
  | null;

type StripeCheckoutSession = {
  id?: string;
  client_reference_id?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_link?: StripeIdLike;
  payment_intent?: StripeIdLike;
};

type StripeEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: {
    object?: StripeCheckoutSession;
  };
};

function stripeId(value: StripeIdLike) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

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

async function webhookSecrets() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("billing_provider_secrets")
    .select("secret_kind,secret_value")
    .eq("provider", "stripe")
    .in("secret_kind", [
      "webhook_signing_secret_live",
      "webhook_signing_secret_test",
    ]);

  if (error) throw error;

  const rows = new Map(
    (data || []).map((row) => [row.secret_kind, row.secret_value]),
  );

  return {
    live:
      process.env.STRIPE_WEBHOOK_SECRET_LIVE?.trim() ||
      rows.get("webhook_signing_secret_live") ||
      null,
    test:
      process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim() ||
      rows.get("webhook_signing_secret_test") ||
      null,
  };
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  const admin = createAdminSupabaseClient();

  try {
    const secrets = await webhookSecrets();
    if (!secrets.live && !secrets.test) {
      return NextResponse.json(
        { error: "Stripe webhook is not configured." },
        { status: 503 },
      );
    }

    const verifiedMode =
      secrets.live && verifyStripeSignature(rawBody, signature, secrets.live)
        ? "live"
        : secrets.test &&
            verifyStripeSignature(rawBody, signature, secrets.test)
          ? "test"
          : null;

    if (!verifiedMode) {
      return NextResponse.json(
        { error: "Invalid Stripe signature." },
        { status: 400 },
      );
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    const eventLivemode = event.livemode === true;

    if (
      typeof event.livemode !== "boolean" ||
      (verifiedMode === "live") !== eventLivemode
    ) {
      return NextResponse.json(
        { error: "Stripe webhook mode does not match its signing secret." },
        { status: 400 },
      );
    }

    const session = event.data?.object;
    const paymentLinkId = stripeId(session?.payment_link || null);
    const paymentIntentId = stripeId(session?.payment_intent || null);

    if (
      !session?.id ||
      !session.client_reference_id ||
      !paymentLinkId
    ) {
      return NextResponse.json({
        received: true,
        ignored: "unrelated session",
      });
    }

    const { data: configuredLink, error: linkError } = await admin
      .from("ai_balance_topup_options")
      .select("id")
      .eq("provider_payment_link_id", paymentLinkId)
      .eq("provider", "stripe")
      .eq("livemode", eventLivemode)
      .maybeSingle();

    if (linkError) throw linkError;
    if (!configuredLink) {
      return NextResponse.json({
        received: true,
        ignored: "unrelated payment link",
      });
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        session.client_reference_id,
      )
    ) {
      return NextResponse.json({
        received: true,
        ignored: "unrelated reference",
      });
    }

    if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const { error } = await admin.rpc("expire_ai_balance_topup", {
        p_intent_id: session.client_reference_id,
        p_provider_session_id: session.id,
        p_metadata: {
          stripeEventId: event.id || null,
          stripeEventType: event.type,
          livemode: eventLivemode,
        },
      });
      if (error) throw error;

      return NextResponse.json({
        received: true,
        closed: true,
        mode: eventLivemode ? "live" : "test",
      });
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return NextResponse.json({
        received: true,
        ignored: "event type",
      });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true, pending: true });
    }

    if (
      typeof session.amount_total !== "number" ||
      session.amount_total <= 0 ||
      session.currency?.toLowerCase() !== "usd"
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
        p_provider_payment_intent_id: paymentIntentId,
        p_provider_payment_link_id: paymentLinkId,
        p_metadata: {
          stripeEventId: event.id || null,
          stripeEventType: event.type,
          livemode: eventLivemode,
        },
      },
    );

    if (error) throw error;

    return NextResponse.json({
      received: true,
      credited: true,
      mode: eventLivemode ? "live" : "test",
      availableMicrousd: Number(availableMicrousd || 0),
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not process Stripe webhook.";
    console.error("AI balance Stripe webhook failed", {
      detail: detail.slice(0, 800),
    });

    return NextResponse.json(
      { error: "Could not process Stripe webhook." },
      { status: 500 },
    );
  }
}
