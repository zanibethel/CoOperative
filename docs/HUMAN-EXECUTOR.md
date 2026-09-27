# Human Executor

Human Executor makes a real person a governed execution option inside CoOperative
without treating the person like an API endpoint.

## Product rule

CoOperative should remove as much friction as possible before work reaches a human:

1. understand the requested outcome;
2. use deterministic code/AI/tools for work they can safely complete;
3. isolate the smallest part that benefits from human judgment, taste, empathy,
   physical presence, or real-device verification;
4. prepare that part as a clear phone-first sequence;
5. show compensation, estimated time, deadline, and requirements before acceptance;
6. never silently expand scope after acceptance;
7. verify automatically where possible;
8. create earnings automatically after verified completion.

Workers do not bid, write proposals, invoice customers, or pay for access to work.

## First preview slice

Route: `/work`

The first slice is deliberately non-financial and non-persistent:

- worker profile/preferences are stored only in browser localStorage;
- one sample CreatorHub iPhone verification task is available;
- the worker sees compensation and effective hourly rate before accepting;
- each step has one primary action and a **Need help?** path;
- completion creates an on-screen **test earnings** result only;
- no Supabase workforce tables are live;
- no payout provider is connected;
- no real money moves.

This lets us validate the human experience before increasing data, money, or
platform authority.

## Planned canonical flow

```text
Outcome requested
  -> CoOperative plan
  -> deterministic / AI / service work
  -> human-needed decision
  -> work order
  -> matching
  -> offer notification
  -> worker accepts
  -> guided phone steps
  -> evidence/submission
  -> verification
  -> earnings
  -> payout
```

## Compensation guardrails

- Every offer must show compensation and estimated human time.
- Matching respects the worker's minimum effective hourly rate.
- If scope materially increases, work pauses and compensation must be re-offered.
- Returning a task because requirements changed should not penalize the worker.
- Workers never pay a fee to unlock or bid on work.
- Customer price, worker compensation, platform/infrastructure allocation, and
  other deductions should be explainable and auditable.

## Database gate

`database/schema-v0.3-human-executor.sql` is a **review-only** proposed schema.
Do not apply it until the owner explicitly approves that database/RLS gate.

The schema is intentionally server-mediated for offer acceptance, assignments,
verification, and earnings. Workers can only directly manage their own profile
and their own step submissions. This prevents workers from forging compensation,
claiming another worker's offer, or creating their own earnings records.

## Activation sequence

1. Validate `/work` UX on phone.
2. Review the proposed schema/RLS model.
3. Apply the approved schema as a versioned Supabase migration.
4. Add authenticated Human Executor APIs for profile, offers, acceptance,
   submissions, verification, and test earnings.
5. Add `human-executor` to the canonical executor contract/database constraint.
6. Route one real low-risk internal CoOperative/CreatorHub task through it.
7. Add real payout onboarding only after identity, tax/compliance, dispute,
   reversal, and payout-state behavior are designed.
