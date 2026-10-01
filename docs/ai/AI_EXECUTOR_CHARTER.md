# CoOperative AI Executor Charter

This document defines how CoOperative may use local, hosted, business-owned, or third-party AI systems as interchangeable reasoning executors.

The model/provider is never the authority. CoOperative remains the governor, router, policy layer, evidence holder, and system of record.

## Purpose

A business may already pay for or operate AI capability such as:

- a local model;
- a business-owned GPU model server;
- a connected commercial AI account;
- a provider API;
- an enterprise AI workspace;
- another approved reasoning service.

CoOperative should be able to use that capability when it is technically available, authorized, economically sensible, and qualified for the task.

The goal is to avoid paying twice for equivalent compute while preserving CoOperative's reasoning context, policies, evidence, verification, and approval boundaries.

AI executors must also inherit the economic principles in `docs/BUSINESS-ECONOMIC-MODEL.md`: customer budget ceilings, no surprise paid fallback, qualified owned/self-hosted preference, projected-vs-verified-vs-realized savings discipline, proof before cancellation, and sustainable CoOperative margin.

## Core rule

> A connected AI executor may contribute reasoning or generation, but it must operate inside CoOperative's decision context. It does not replace CoOperative's policies, evidence, or owner direction.

Third-party AI output is advisory until CoOperative validates it against applicable evidence, policy, and task requirements.

## CoOperative Reasoning Envelope

Before a qualified AI executor is asked to reason about a meaningful business or platform decision, CoOperative should provide the smallest sufficient structured context containing:

1. **Objective** — the concrete outcome being pursued.
2. **Owner/business direction** — applicable operating principles, goals, preferences, and explicit constraints.
3. **Current evidence** — relevant live state, retrieved facts, code, costs, provider capabilities, logs, or business data.
4. **Known decisions** — prior approved decisions that materially constrain the task.
5. **Current working analysis** — a concise decision summary: alternatives considered, why the current direction is being evaluated, and important tradeoffs.
6. **Uncertainty** — unresolved facts or assumptions that must not be silently treated as known.
7. **Economic constraints** — cost ceilings, savings targets, margin requirements, or paid-compute restrictions.
8. **Risk/approval boundaries** — actions the executor may not take and decisions that require human approval.
9. **Required output** — the requested schema, evidence standard, recommendation type, or artifact.

This is a structured decision context, not a requirement to expose hidden chain-of-thought from any model or assistant.

## Business-owned AI

A business-owned AI connection is an execution resource controlled or paid for by that business.

Examples may include:

- the owner's local model or GPU;
- a business-managed model server;
- an approved API account billed to the business;
- an enterprise AI provider connection;
- another authenticated AI tool that exposes a supported integration path.

CoOperative should track, where available:

- provider and model/capability;
- owner/tenant;
- authorization method;
- whether programmatic use is actually supported;
- billing owner and marginal cost;
- context/input limits;
- supported modalities;
- latency;
- reliability;
- data-retention/privacy properties;
- tool/action permissions;
- current availability;
- benchmark/evaluation results.

A consumer subscription or interactive account must not be assumed to provide API or automation access. The connector must declare the actual supported access path and billing behavior.

## Routing policy

When AI reasoning is required, CoOperative should prefer the lowest-marginal-cost qualified executor consistent with privacy, reliability, capability, and owner policy.

Typical order:

```text
known deterministic code/playbook
  -> business-owned/local AI
  -> business-owned connected AI
  -> CoOperative-owned hosted AI
  -> explicitly approved paid external AI
  -> human decision when uncertainty/risk requires it
```

The cheapest option does not automatically win. The executor must meet the task's quality, privacy, latency, reliability, and capability floor.

## Policy inheritance

Every connected AI executor inherits CoOperative's applicable policies.

It may not override:

- owner-approved operating principles;
- business-specific restrictions;
- tenant isolation;
- secret-handling rules;
- cost ceilings;
- approval gates;
- security controls;
- legal/compliance constraints;
- production-change boundaries.

If the executor recommends something that conflicts with these policies, CoOperative must surface the conflict rather than silently following the recommendation.

## Evidence and verification

For meaningful decisions, an AI executor should be asked to distinguish:

- facts supported by supplied/retrieved evidence;
- calculations;
- assumptions;
- recommendations;
- unresolved questions.

CoOperative should independently verify important outputs using deterministic checks, retrieved provider data, a verifier, or human review as appropriate.

A stronger model is not a substitute for verification.

## Migration and optimization use

When evaluating a cheaper or better business solution, the reasoning envelope should include:

- current provider/service;
- actual cost;
- features actually used;
- required service levels;
- candidate replacements;
- switching/migration cost;
- reliability/security implications;
- rollback requirements;
- expected savings;
- CoOperative/customer economic split where applicable.

The AI executor may help research, compare, design, or explain a migration. CoOperative remains responsible for validating the plan and enforcing approval before high-impact execution.

## Learning loop

Useful third-party AI work should leave durable value behind.

When a reasoning result proves correct, CoOperative should capture reusable knowledge as appropriate:

- deterministic code;
- migration playbooks;
- provider capability maps;
- tests/evals;
- cost benchmarks;
- decision rules;
- known failure modes;
- generalized lessons.

The goal is to reduce how much model reasoning is required for the next similar task.

## Provider neutrality

No playbook should depend on GPT, Claude, Gemini, Qwen, or any other named model unless a provider-specific capability is genuinely required.

Prefer capability requests such as:

```text
capability: structured_business_reasoning
quality_floor: required
maximum_incremental_cost: policy-defined
privacy: tenant-approved
verification: required
```

The AI Router selects among available approved executors.

## Secrets and credentials

Do not place provider credentials, session tokens, passwords, API keys, private prompts containing secrets, or customer secret material in this document, model prompts, logs, diffs, or generated explanations.

Use approved secret references and provider authorization flows only.

## Human authority

Business owners retain authority over consequential business decisions.

Connecting a more capable AI does not expand CoOperative's permissions.

AI connection means:

> "This executor may help CoOperative reason."

It does not mean:

> "This executor may spend money, migrate production systems, change permissions, or make irreversible decisions without the required approval."
