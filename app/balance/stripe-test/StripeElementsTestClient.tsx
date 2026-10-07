"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

type CheckoutStart = {
  clientSecret?: string;
  publishableKey?: string;
  sessionId?: string;
  amountUsd?: number;
  error?: string;
  detail?: string;
};

type SessionStatus = {
  status?: string | null;
  paymentStatus?: string | null;
  fundingStatus?: string | null;
  error?: string;
};

function TestPaymentForm({ amountUsd }: { amountUsd: number }) {
  const checkoutState = useCheckoutElements();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  if (checkoutState.type === "loading") {
    return <p className="muted">Loading secure payment form…</p>;
  }

  if (checkoutState.type === "error") {
    return (
      <div className="error-box">
        {checkoutState.error?.message || "Stripe Checkout could not load."}
      </div>
    );
  }

  const checkout = checkoutState.checkout;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working) return;

    setWorking(true);
    setMessage("");

    try {
      const result = await checkout.confirm();
      if ("error" in result && result.error) {
        setMessage(result.error.message || "Payment could not be confirmed.");
        setWorking(false);
        return;
      }

      setMessage("Payment submitted. Waiting for Stripe confirmation…");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Payment could not be confirmed.",
      );
      setWorking(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PaymentElement />
      <button className="primary" type="submit" disabled={working}>
        {working ? "Confirming…" : `Pay $${amountUsd.toFixed(2)} test`}
      </button>
      {message ? <p className="ai-balance-status">{message}</p> : null}
    </form>
  );
}

export default function StripeElementsTestClient() {
  const [clientSecret, setClientSecret] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [amountUsd, setAmountUsd] = useState(10);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [returnStatus, setReturnStatus] = useState<SessionStatus | null>(null);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  useEffect(() => {
    const returnedSessionId = new URLSearchParams(window.location.search).get(
      "session_id",
    );
    if (!returnedSessionId) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/billing/stripe/session-status?session_id=${encodeURIComponent(
            returnedSessionId,
          )}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as SessionStatus;
        if (!cancelled) setReturnStatus(result);
      } catch {
        if (!cancelled) {
          setReturnStatus({ error: "Could not read checkout status." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout() {
    if (working) return;
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/billing/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topUpOptionId: "stripe-elements-test-10" }),
      });
      const result = (await response.json()) as CheckoutStart;

      if (
        !response.ok ||
        !result.clientSecret ||
        !result.publishableKey ||
        !result.sessionId
      ) {
        throw new Error(
          result.detail || result.error || "Could not start Stripe Checkout.",
        );
      }

      setClientSecret(result.clientSecret);
      setPublishableKey(result.publishableKey);
      setSessionId(result.sessionId);
      setAmountUsd(result.amountUsd || 10);
      setMessage("Secure Stripe test checkout is ready.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not start Stripe Checkout.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="card ai-balance-card">
      <div>
        <h2>Embedded Stripe Checkout</h2>
        <p>
          Test mode only. Payment details stay inside Stripe Elements and never
          touch the CoOperative server.
        </p>
      </div>

      {returnStatus ? (
        <div>
          <strong>Returned checkout</strong>
          <p>
            Stripe: {returnStatus.status || "unknown"} · Payment:{" "}
            {returnStatus.paymentStatus || "unknown"} · Funding:{" "}
            {returnStatus.fundingStatus || "unknown"}
          </p>
          {returnStatus.error ? (
            <div className="error-box">{returnStatus.error}</div>
          ) : null}
        </div>
      ) : null}

      {!clientSecret || !stripePromise ? (
        <button
          className="primary"
          type="button"
          disabled={working}
          onClick={() => void startCheckout()}
        >
          {working ? "Starting…" : "Open $10 embedded test checkout"}
        </button>
      ) : (
        <CheckoutElementsProvider
          key={sessionId}
          stripe={stripePromise}
          options={{ clientSecret }}
        >
          <TestPaymentForm amountUsd={amountUsd} />
        </CheckoutElementsProvider>
      )}

      {message ? <p className="ai-balance-status">{message}</p> : null}
    </section>
  );
}
