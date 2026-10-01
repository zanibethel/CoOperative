# CoOperative Canonical Business Economic Model

Last updated: 2026-10-01

This document is the canonical commercial and economic model for CoOperative business accounts. Product, routing, migration, billing, savings reporting, AI behavior, and future pricing work should preserve these principles unless a later explicit owner decision supersedes them.

## Product promise

CoOperative should help a business get equal or better operational capability for less total cost while staying inside a budget the business explicitly controls.

The business should be able to connect what it already uses and pays for, including software, infrastructure, AI services, business-owned hardware, and supported external providers. CoOperative should understand what each resource actually does, what it costs, and whether a cheaper qualified replacement can do the same work or better work.

A replacement may be:

- native CoOperative functionality;
- deterministic automation or a published playbook;
- a self-installed application;
- a business-owned PC, workstation, server, or GPU;
- a private or business-owned Unison node;
- qualified Unison community capacity;
- an open-weight/self-hosted model;
- a business-owned paid AI/API account;
- another connected SaaS/API;
- CoOperative-managed infrastructure;
- human work where genuinely required.

"New system" does not mean "another subscription." It means the lowest-total-cost qualified system that satisfies the business requirement.

## Economic contract

CoOperative must optimize for two outcomes at the same time:

1. **The customer saves money and/or receives measurably better value.**
2. **CoOperative remains sustainably profitable.**

Customer savings must never be created by operating CoOperative at a structural loss.

For each business, track at minimum:

- current external-service baseline;
- current AI/API baseline;
- current infrastructure baseline;
- approved total operating budget;
- approved CoOperative-managed budget;
- funded CoOperative balance;
- target savings;
- minimum quality/reliability requirements;
- CoOperative gross-margin floor;
- external spend remaining;
- CoOperative-managed spend;
- node/human/provider payouts;
- infrastructure and API cost;
- projected savings;
- verified savings;
- realized savings.

## Hard budget rule

The business controls the maximum spend.

CoOperative must not knowingly authorize customer-specific spend beyond the customer's approved budget or available funded balance.

When a proposed route would exceed the budget, CoOperative should, in order:

1. choose a cheaper qualified executor/provider;
2. use business-owned/local compute where economical;
3. use deterministic automation/playbooks instead of paid reasoning;
4. batch/cache/reuse work where safe;
5. defer optional work;
6. request explicit approval for a higher budget if the required outcome cannot fit.

No surprise paid fallback.

## Margin rule

A route is not economically valid merely because it saves the customer money.

For managed work, track:

```text
customer charge
  - AI/API expense
  - Unison/node payouts
  - human payouts
  - infrastructure expense
  - other variable service cost
  = CoOperative gross profit
```

CoOperative should enforce a configurable gross-margin floor. The current platform direction is to target at least 50% gross margin where practical, while allowing product-specific economics to be explicitly configured.

If a route would fall below the applicable margin floor, CoOperative should optimize the route, change pricing within the customer's approved budget, seek approval for a different plan, or decline the uneconomic route.

## Funded CoOperative balance

A business should be able to maintain a CoOperative balance used for approved managed services.

Target behavior:

- business funds balance through supported payment rails;
- CoOperative deducts approved managed costs from that balance;
- optional auto-refill may replenish to a configured target;
- a hard monthly/account ceiling remains enforceable;
- insufficient balance does not silently become platform-funded spend;
- customer-facing ledger explains where balance was used.

A future configuration may look like:

```text
Current balance: $147
Refill threshold: $100
Refill target: $500
Monthly hard ceiling: $600
```

## Routing economics

For each task, CoOperative should select the lowest-total-cost qualified route that satisfies quality, privacy, reliability, latency, permissions, and business policy.

Typical business route order:

```text
known deterministic code/playbook
  -> business-owned/self-installed capability
  -> business-owned local/Unison node
  -> business-owned connected AI/API
  -> qualified private/community Unison capacity
  -> CoOperative-owned managed capability
  -> approved external SaaS/API/AI
  -> human execution when required
```

The exact order may change for privacy, quality, latency, or reliability requirements. Cheapest is not automatically best; qualified total value is the criterion.

## Migration rule: prove before replacing

CoOperative should not recommend cancellation based only on a projection.

Use the progression:

```text
connect
  -> measure current capability + cost
  -> identify candidate replacement
  -> estimate economics
  -> run alongside current service
  -> shadow-test / reconcile
  -> verify quality and reliability
  -> measure actual replacement cost
  -> request required approval
  -> migrate
  -> verify production result
  -> downgrade/cancel legacy service only after confirmation
```

Savings states:

- **Projected savings** — modeled but not proven.
- **Verified savings** — replacement has successfully demonstrated equivalent/better service and measured expected cost.
- **Realized savings** — legacy spend has actually been reduced or removed.

Do not report projected savings as realized savings.

## Customer reporting

Businesses should eventually receive daily, weekly, and monthly economic reporting.

Reports should show:

- original baseline cost;
- current external spend;
- CoOperative-managed spend;
- estimated equivalent legacy cost;
- projected, verified, and realized savings;
- savings percentage;
- service quality/reliability outcomes;
- migrations in shadow-test;
- upcoming renewals/cancellation opportunities;
- remaining approved budget;
- current CoOperative balance.

The dashboard should make it obvious whether the business is actually spending less than it was before.

## Owner/platform reporting

The CoOperative owner view should show customer economics and platform economics separately.

Track:

- customer revenue through CoOperative;
- AI/API expense;
- infrastructure expense;
- Unison/node payouts;
- human payouts;
- refunds/credits where applicable;
- gross profit;
- gross margin;
- customer realized savings;
- customer retention/value;
- structurally losing accounts/routes.

Never hide platform losses behind customer savings.

## Business intake

Business intake should capture enough information to establish a starting economic envelope, including:

- services currently used;
- monthly/annual cost where known;
- AI/API spend;
- current technology/infrastructure spend;
- business-owned compute;
- current budget;
- acceptable maximum budget;
- desired savings target;
- quality/reliability requirements;
- services the business must keep;
- willingness to self-host/use owned compute;
- willingness to contribute excess compute to Unison.

Unknown numbers should be marked unknown and discovered later; do not invent them.

## Conversation-first product experience

The primary business experience should be conversational.

Chat is the control surface; economic policy and execution systems remain authoritative underneath it.

The target workspace should feel familiar to users of modern AI assistants while remaining purpose-built for business operations:

- **Chat / conversations** — primary interaction surface;
- **Projects / businesses** — context boundary for each company, initiative, or migration;
- **Connected Services** — software, accounts, AI providers, infrastructure, and data sources;
- **Tools / Capabilities** — what CoOperative can currently execute;
- **Budget & Savings** — baseline, funded balance, spend ceiling, savings, margin-safe service status;
- **Approvals** — consequential actions, paid execution, migrations, and irreversible changes;
- **Activity / Evidence** — what ran, what it cost, what changed, and how it was verified.

A user should be able to ask in chat:

> What am I spending too much on?

or:

> Can we replace this service without losing anything?

or:

> Why did CoOperative use Claude instead of our GPU?

and CoOperative should answer from current evidence and provide direct actions/links.

## Internal AI mentality

Every CoOperative AI executor should operate with these principles:

1. improve customer economics, not activity volume;
2. stay inside the customer's explicit budget;
3. prefer qualified owned/self-hosted resources when economically sensible;
4. do not spend simply because budget exists;
5. protect CoOperative margin and avoid structurally losing service;
6. distinguish projected, verified, and realized savings;
7. prove replacements before recommending cancellation;
8. never invent cost, savings, capability, or reliability evidence;
9. preserve privacy, quality, security, approval, and rollback requirements;
10. treat external models/providers as replaceable executors, not authorities;
11. turn successful repeated reasoning into code/playbooks so future work gets cheaper;
12. explain tradeoffs in terms the business owner can understand.

These principles apply to local AI, connected business AI, paid APIs, agents, migration planners, and future CoOperative-specific models.

## North-star commercial loop

```text
understand current spend
  -> establish hard budget + funded balance
  -> connect existing services/capabilities
  -> find lower-total-cost qualified alternatives
  -> prefer owned/self-hosted capacity where useful
  -> test replacement beside current system
  -> verify quality + actual cost
  -> migrate only after proof/approval
  -> reduce legacy spend
  -> report realized savings
  -> retain sustainable CoOperative margin
  -> reuse the successful playbook
  -> repeat
```

The desired result is not merely a cheaper invoice. It is a business that increasingly owns or controls more of its operational capability, spends less for equal or better outcomes, and funds a sustainable CoOperative service layer that continues finding and executing improvements.
