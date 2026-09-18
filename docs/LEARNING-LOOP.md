# Governed Learning Loop

CoOperative's "learning" is intentionally explicit, auditable, and playbook-first.

See `docs/CORE-OPERATING-MODEL.md` for the platform doctrine this loop must preserve.

## What learning means

It does **not** initially mean retraining model weights, creating ever-larger prompts, or allowing an agent to rewrite production code on its own.

The system learns by improving durable platform knowledge:

- scripts/functions;
- playbooks and their versions;
- capability contracts;
- connector implementations;
- business policies and approval rules;
- evaluation sets;
- outcome evidence;
- cost/performance history.

AI should consume this knowledge when needed. AI should not be required to rediscover it.

## Evidence recorded

For each deployed process, capture where appropriate:

- which business pattern was observed;
- which playbook/version was recommended;
- which scripts/functions were executed;
- which capabilities/providers were selected;
- which AI capability/model was selected, if any;
- AI token/usage cost;
- external provider cost;
- total estimated and actual service cost;
- execution success/failure rate;
- hours of human work avoided;
- human interventions;
- conversion/revenue metrics;
- customer feedback;
- known limitations.

That evidence improves future routing and playbook versions.

## Preferred improvement

The strongest improvement is often **less AI**, not more AI.

Example:

```text
Playbook v7
  AI calls/run: 3
  avg cost: $0.041

Playbook v8
  AI calls/run: 1
  deterministic filtering replaces two reasoning calls
  avg cost: $0.012
  quality floor maintained
```

If deterministic code can safely replace an AI step, prefer it.

## Cross-customer reuse

CoOperative may reuse a generalized pattern learned from one deployment without exposing another customer's private data.

Example:

- Customer A proves that cancellation detection + waitlist outreach works well.
- The system records the generalized playbook, scripts, and outcome metrics.
- Customer B has the same operational pattern.
- CoOperative can suggest the proven playbook, adapted to Customer B's tools, permissions, and cost envelope.

Raw customer messages, contacts, documents, credentials, or other tenant-specific data must never become a shared playbook.

## Hermes role

Hermes is the Platform Operative / Improvement Engineer.

Hermes should focus its budget on high-leverage platform work:

- researching new providers;
- finding official OAuth/API/webhook/import paths;
- creating and maintaining connectors;
- identifying cheaper AI/providers;
- benchmarking replacements;
- reducing unnecessary model calls;
- replacing reasoning steps with deterministic code where safe;
- improving playbooks;
- preparing isolated code changes;
- running tests and evals;
- estimating platform/customer savings.

Hermes should improve CoOperative's institutional knowledge rather than repeatedly solving the same customer problem from scratch.

## Improvement proposal lifecycle

```text
observed evidence
    -> proposed
    -> AI/Hermes review
    -> owner review
    -> approved for build
    -> isolated branch / PR
    -> automated tests + security checks
    -> AI review + owner review
    -> ready for merge
    -> human merge/deploy
```

Low-risk categories may eventually earn additional automation under an explicit policy. High-risk categories remain human-gated.

## Research loop

Hermes or another approved research agent may periodically check official sources for:

- new APIs;
- OAuth availability;
- pricing changes;
- deprecations;
- cheaper providers/models;
- open-source/self-hosted options;
- new native CoOperative replacement opportunities.

Research updates the Capability Registry and Service Provider catalog as **research candidates** first.

Candidates are not automatically trusted or executable.

## Connector learning loop

```text
discover provider
  -> research official connection paths
  -> define capability/scopes/risk
  -> build connector in isolation
  -> test
  -> security review
  -> owner approval
  -> publish
  -> observe reliability + cost
  -> maintain/replace
```

Connector knowledge should be reusable across customers while credentials and tenant data remain isolated.

## Cost-learning loop

Every workflow should be able to answer:

- What did this execution cost?
- What part was AI?
- What part was external infrastructure?
- Was a cheaper approved path available?
- Did quality stay above the required floor?
- Does this account still fit its plan cost envelope?

If not, CoOperative should optimize the execution path or surface a package/usage decision instead of silently operating at a structural loss.

## Autonomy ladder

Each mission and platform update class can earn greater autonomy based on risk and evidence:

1. **Suggest only** — AI/Hermes recommends; human performs action.
2. **Draft/build** — AI/Hermes prepares the action/change; human approves execution.
3. **Guarded execute** — routine low-risk actions run automatically; exceptions require approval.
4. **Autonomous within policy** — system executes only inside explicit rules, quality thresholds, cost ceilings, tests, and rollback limits.

High-impact actions can remain permanently human-approved regardless of success history.
