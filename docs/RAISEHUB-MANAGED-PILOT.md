# RaiseHub Managed Project Pilot

## Goal

Use RaiseHub as CoOperative's first real managed project and proving ground for the Improvement Engine.

RaiseHub remains an independent product and repository:

- repository: `zanibethel/raisehub`;
- application stack: Next.js;
- database/auth: Supabase;
- hosting: Vercel;
- email/event integration: Resend;
- payments: Stripe.

CoOperative should connect to RaiseHub, understand it, propose improvements, execute approved work through the cheapest qualified executor, verify the result, and learn from the outcome.

## Why RaiseHub is a strong pilot

RaiseHub already follows principles compatible with CoOperative:

- deterministic rules before AI;
- AI explains rather than controls platform policy;
- owner-first operating console;
- server-side authorization;
- RLS;
- audit-oriented support model;
- demo/live isolation;
- GitHub CI;
- measurable business outcomes.

This means CoOperative can add improvement capability without asking RaiseHub to abandon its architecture.

## Initial operating mode

Start in:

```text
Observe + Propose + PR-only
```

Do not grant broad production-write authority.

RaiseHub currently documents that development and production share the same Supabase project, so database writes, destructive tests, financial-impact changes, and broad assisted editing stay explicitly owner-gated until environment separation is complete.

## Phase 1 — Project registration

Create a managed-project record for RaiseHub containing:

- repository;
- Vercel project;
- Supabase project;
- Resend connection;
- Stripe connection;
- current environment model;
- production-write policy;
- project operating documents;
- current fixed/variable service costs as they become available.

## Phase 2 — Policy/context ingestion

Use RaiseHub's own repository documentation as project policy/context, including:

- `ARCHITECTURE_PRINCIPLES.md`;
- `BUSINESS_PHILOSOPHY.md`;
- `PROJECT_STATUS.md`;
- `ROADMAP.md`;
- `HERMES_PLAYBOOK.md`;
- `docs/OWNER_PLATFORM.md`;
- `docs/SUPABASE_STANDARDS.md`;
- `TECHNICAL_AUDIT.md`;
- `LESSONS_LEARNED.md`.

Do not blindly copy all documents into every AI prompt. Extract durable policy, project facts, constraints, goals, and relevant current-state context into CoOperative's structured memory/project profile.

## Phase 3 — First Improvement Audit

CoOperative should generate a small ranked set of evidence-based opportunities across:

### Cost
- Vercel;
- Supabase;
- Resend;
- Stripe-related platform overhead;
- storage;
- unnecessary paid services;
- AI/model usage when introduced.

### Reliability
- deployment failures;
- production logging/monitoring gaps;
- shared dev/prod database risk;
- webhook reliability;
- backup/recovery readiness.

### Development efficiency
- duplicated business logic;
- repeated manual setup;
- reusable scripts/playbooks that are missing;
- test/CI gaps;
- deterministic logic currently being rediscovered.

### Business growth
- campaign conversion opportunities;
- offer performance;
- business activation/reactivation;
- organization success;
- customer value/retention;
- revenue leakage.

### AI reduction
- places where deterministic rules can replace AI;
- places where AI should be limited to explanation/content generation.

Return only the strongest opportunities, not a long generic backlog.

## Phase 4 — Decision Brief

Each opportunity should include:

- evidence;
- expected economic/reliability benefit;
- estimated implementation effort;
- incremental infrastructure/AI cost;
- risk;
- recommended executor;
- whether AI is required;
- owner gate;
- measurement;
- rollback.

## Phase 5 — First governed improvement

Choose one low-risk measurable improvement.

Preferred first change characteristics:

- no production database migration;
- no payment movement;
- no destructive change;
- can be implemented by ChatGPT through connected tools if possible;
- branch/PR;
- CI;
- preview or deterministic verification;
- measurable before/after evidence.

Hermes should only receive a subtask when shell/runtime/background execution is genuinely required.

## Phase 6 — Measure and learn

After the change:

- record implementation cost;
- record AI/Hermes spend if any;
- record actual benefit;
- record failures/edge cases;
- decide whether the technique should become a reusable CoOperative playbook.

## RaiseHub domain mapping

Translate RaiseHub-specific concepts into general CoOperative concepts:

```text
campaign             -> revenue/fundraising initiative
offer                -> promotion/value proposition
redemption           -> conversion/outcome event
business             -> participating business entity
organization         -> fundraising/customer organization
customer             -> end-user/customer entity
support request      -> operational friction signal
RaiseHub rule engine -> deterministic capability
Owner Console        -> governed operating surface
```

The adapter should preserve RaiseHub-specific data while allowing CoOperative to reason using reusable platform concepts.

## Success criteria

The pilot is successful when CoOperative can:

1. identify RaiseHub and its connected stack;
2. retrieve relevant project policy/context without owner re-explanation;
3. surface a real evidence-based improvement;
4. explain cost/risk/value in a Decision Brief;
5. route implementation to the lowest-cost qualified executor;
6. create/verify a governed change;
7. measure the outcome;
8. preserve the lesson as reusable CoOperative knowledge.

The pilot should prove that future products can connect the same way without being merged into CoOperative.
