# CoOperative

**Human + AI business operations.**

CoOperative learns how a business works, maps the services it already pays for, identifies work that can be improved or automated, and continuously looks for credible ways to protect revenue, save money, make more money, and create new revenue.

The long-term product is a conversational business operating system. CoOperative owns the experience; AI models and external providers are replaceable infrastructure underneath it.

## Core doctrine

**Playbooks and code first. AI only where reasoning is actually needed.**

If CoOperative already knows how to perform a process, it should use the stored playbook, script, function, rule, or approved capability rather than paying an LLM to rediscover the same process.

The durable platform knowledge lives in:

- versioned operational and growth playbooks;
- deterministic scripts/functions;
- capability and connector contracts;
- policies and approval rules;
- cost controls;
- tests and evaluation sets;
- revenue/cost/outcome evidence.

See `docs/CORE-OPERATING-MODEL.md`.

## Economic mandate

Every meaningful CoOperative action should support at least one of these:

1. **Protect revenue**
2. **Save money**
3. **Increase existing revenue**
4. **Create a credible new revenue path**

CoOperative should improve current processes and also proactively identify measurable opportunities such as reactivation, advertising, upsells, referrals/affiliates, new channels, new products/services, and AI-enabled offerings.

## Platform loop

1. **Mission Briefing** — understand the business, goals, constraints, and workflows.
2. **Connected Services Map** — understand what the business already pays for and actually uses.
3. **Capability Registry** — know which native/external capabilities are approved and what they cost.
4. **Playbook Engine** — choose the best known reusable process.
5. **Growth Opportunity Engine** — continuously look for economically useful opportunities.
6. **Script/Function Library** — perform deterministic work without AI.
7. **AI Router** — use the cheapest qualified AI only for reasoning/generation steps.
8. **Capability Router** — choose the approved native or connected service implementation.
9. **Mission Control** — execute within permissions, approvals, and the customer's cost envelope.
10. **Evidence** — measure cost, revenue, margin, failures, time saved, conversion, and human interventions.
11. **Improvement Lab / Hermes** — improve playbooks, connectors, provider choices, scripts, growth patterns, and platform code under governance.

## Current scope

Business intake → validated analysis → connected-service/cost mapping → process map → ranked automation opportunities → governed capability/playbook foundation.

The first analyzer is intentionally deterministic. AI is added behind stable contracts so providers can be replaced without rewriting the application.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Zod runtime validation
- Supabase for auth, Postgres, RLS, and persistence
- Vercel deployment

## Run locally

```bash
npm install
npm run dev
```

Then visit `http://localhost:3000`.

## Architecture

```text
Business owner / conversation
        |
        v
Business state + policies + economic goals
        |
   +----+------------------+
   |                       |
   v                       v
Playbook Engine      Growth Opportunity Engine
   |
   +----+----+
   |         |
   v         v
Scripts    AI Router
   |         |
   +----+----+
        |
        v
 Capability Router
        |
   +----+----+
   |         |
 native    connected provider
   |         |
   +----+----+
        |
        v
 Execution + Mission Control
        |
        v
 Revenue + Cost + Outcome Ledger
        |
        v
 Evidence / Improvement Lab
        |
        v
       Hermes
        |
        v
 governed playbook / connector / growth / code improvements
```

See `docs/CORE-OPERATING-MODEL.md`, `docs/PLATFORM-VISION.md`, `docs/LEARNING-LOOP.md`, and `docs/WEEK-01.md`.
