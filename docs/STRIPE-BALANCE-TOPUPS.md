# Stripe AI balance top-ups

CoOperative uses Stripe Payment Links plus a signed webhook to fund prepaid AI
balances. Payment fulfillment is webhook-driven; the success redirect never
credits a balance.

## Production flow

1. An authenticated user selects a live row in `ai_balance_topup_options`.
2. `POST /api/profile/ai-balance` creates an
   `ai_balance_funding_intents` row and appends its UUID as
   `client_reference_id` to the configured Stripe Payment Link.
3. Stripe sends the resulting Checkout Session to
   `/api/billing/stripe/webhook`.
4. The webhook verifies the Stripe signature, validates the Payment Link,
   amount, currency, mode, and funding-intent reference, then calls
   `complete_ai_balance_topup`.
5. The database function atomically credits `ai_profile_balances`, writes
   `ai_profile_balance_ledger`, and marks the funding intent paid.

The webhook handles:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

## Signing secrets

Use Vercel Sensitive environment variables:
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_WEBHOOK_SECRET_LIVE`

The webhook also preserves the existing database fallback for
`billing_provider_secrets` so an already-configured live secret is not broken.

Never commit Stripe signing secrets or API keys to GitHub.

## Isolated test mode

The owner-only page at `/balance/stripe-test` uses a separate profile ref:

`stripe-test:<user-id>`

This allows a real Stripe test-mode Payment Link and webhook to exercise the
entire funding-intent and ledger path without creating spendable production AI
credits.

Current Stripe test resources:
- Product: `prod_VOY61p99IfMjr6`
- Price: `price_1UNl01PywVHCXFYifBkEUlL3`
- Payment Link: `plink_1UNl0UPywVHCXFYicHa9151f`
- Webhook endpoint: `we_1UNl0zPywVHCXFYiKrX224Vb`
- Test top-up option: `stripe-test-10` ($10)

After the test webhook is verified end to end, create live Payment Links for the
chosen top-up denominations and insert matching rows with `livemode = true`.
