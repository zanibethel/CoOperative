# Stripe AI balance top-ups

CoOperative uses Stripe Checkout Sessions with `ui_mode: "elements"` and
Stripe's Payment Element for prepaid AI balance funding. Payment fulfillment is
webhook-driven; the browser return page never credits a balance.

## Checkout flow

1. The user chooses a server-defined row in `ai_balance_topup_options`.
2. `POST /api/billing/stripe/checkout` authenticates the user and creates an
   `ai_balance_funding_intents` row.
3. The server creates a Stripe Checkout Session with:
   - `ui_mode: "elements"`
   - `mode: "payment"`
   - a server-controlled USD amount
   - `client_reference_id` equal to the funding-intent UUID
   - signed reconciliation metadata
   - a CoOperative return URL
4. The browser initializes `CheckoutElementsProvider` with the Session
   `client_secret` and renders `PaymentElement`.
5. The browser calls `checkout.confirm()`.
6. Stripe sends the payment result to
   `/api/billing/stripe/webhook`.
7. The webhook verifies the Stripe signature, environment, Checkout Session,
   funding-intent reference, amount, currency, and metadata, then calls
   `complete_ai_balance_topup`.
8. The database function atomically credits `ai_profile_balances`, writes
   `ai_profile_balance_ledger`, and marks the funding intent paid.

## Stripe environment variables

Use Vercel Sensitive environment variables for secrets:

- `STRIPE_RESTRICTED_KEY_TEST`
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_RESTRICTED_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_LIVE`

Publishable keys are safe for the browser but are still configured through
Vercel:

- `STRIPE_PUBLISHABLE_KEY_TEST`
- `STRIPE_PUBLISHABLE_KEY_LIVE`

Use Stripe restricted keys with the minimum permissions required for Checkout
Session creation/retrieval. Never commit keys or webhook secrets to GitHub.

## Webhook events

The Stripe endpoint listens for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

The webhook supports both the current Checkout Sessions + Elements flow and
the earlier Payment Link records during migration.

## Isolated test mode

The owner-only page at `/balance/stripe-test` uses a separate profile ref:

`stripe-test:<user-id>`

Test Stripe payments can therefore exercise the full funding-intent, Checkout,
webhook, and ledger path without creating spendable production AI balance.

The current test option is:

- `stripe-elements-test-10`: $10 USD, test mode, Checkout Sessions + Elements

The older test Payment Link remains only as a migration fallback and is not the
target production checkout architecture.

## Go-live rule

Do not add `livemode = true` top-up options until the test flow has verified:

1. Checkout Session creation.
2. Payment Element rendering.
3. Successful test payment.
4. Signed webhook delivery.
5. Exactly-once ledger credit.
6. Correct balance increase after webhook processing.
7. Failed/expired payments do not credit balance.
