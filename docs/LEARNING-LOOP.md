# Governed Learning Loop

CoOperative's "learning" is intentionally explicit and auditable.

## What learning means

It does **not** initially mean retraining model weights or allowing an agent to rewrite production code on its own.

The system learns by storing structured evidence:

- which business pattern was observed;
- which playbook/version was recommended;
- which implementation was deployed;
- setup and ongoing cost;
- execution success/failure rate;
- hours of human work avoided;
- human interventions;
- conversion/revenue metrics where appropriate;
- customer feedback;
- known limitations.

That evidence can improve future recommendations.

## Cross-customer reuse

CoOperative may reuse a **pattern** learned from one deployment without exposing another customer's private data.

Example:

- Customer A proves that cancellation detection + waitlist outreach works well.
- The system records the generalized playbook and outcome metrics.
- Customer B has the same operational pattern.
- CoOperative can suggest the proven playbook, adapted to Customer B's tools and permissions.

Raw customer messages, contacts, documents, credentials, or other tenant-specific data must never become a shared playbook.

## Improvement proposal lifecycle

```text
observed evidence
    -> proposed
    -> AI review
    -> owner review
    -> approved for build
    -> isolated branch / PR
    -> automated tests + security checks
    -> AI review + owner review
    -> ready for merge
    -> human merge/deploy
```

No production code change skips the approval gate.

## Research loop

A research agent may periodically check approved sources for new APIs, pricing changes, deprecations, better open-source options, and new platform capabilities.

Research updates the Capability Registry as **research candidates** first. Candidates are not automatically trusted or executable.

## Autonomy ladder

Each mission can earn greater autonomy based on risk and evidence:

1. **Suggest only** — AI recommends; human performs action.
2. **Draft** — AI prepares action; human approves every execution.
3. **Guarded execute** — routine low-risk actions run automatically; exceptions require approval.
4. **Autonomous within policy** — system executes only inside explicit rules and limits.

High-impact actions can remain permanently human-approved regardless of success history.
