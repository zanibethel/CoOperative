import "server-only";

import Stripe from "stripe";

export type CooperativeStripeMode = "test" | "live";

function keyForMode(mode: CooperativeStripeMode) {
  const key =
    mode === "live"
      ? process.env.STRIPE_RESTRICTED_KEY_LIVE
      : process.env.STRIPE_RESTRICTED_KEY_TEST;

  if (!key?.trim()) {
    throw new Error(
      mode === "live"
        ? "Stripe live restricted key is not configured."
        : "Stripe test restricted key is not configured.",
    );
  }

  return key.trim();
}

export function stripeClient(mode: CooperativeStripeMode) {
  return new Stripe(keyForMode(mode), {
    apiVersion: "2026-08-26.dahlia",
    appInfo: {
      name: "CoOperative",
      version: "0.1.0",
      url: "https://cooperative.chat",
    },
  });
}

export function stripePublishableKey(mode: CooperativeStripeMode) {
  const key =
    mode === "live"
      ? process.env.STRIPE_PUBLISHABLE_KEY_LIVE
      : process.env.STRIPE_PUBLISHABLE_KEY_TEST;

  if (!key?.trim()) {
    throw new Error(
      mode === "live"
        ? "Stripe live publishable key is not configured."
        : "Stripe test publishable key is not configured.",
    );
  }

  return key.trim();
}
