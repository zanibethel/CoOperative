# Governed AI Escalation

Last updated: 2026-10-02

CoOperative should not force every task through the same model.

The routing objective is:

> Use the cheapest qualified executor that can reliably complete the task, while preserving business policy, privacy, evidence, and approval boundaries.

A stronger paid model is an escalation resource, not the default.

## Decision flow

```text
deterministic code / playbook
        ↓
owned/local Fast or Quality
        ↓
bounded wait + verification
        ↓
local unavailable / stalled / failed?
   ┌────┴────┐
   no        yes
   ↓          ↓
accept     strict-free cloud route
               ↓
         usable verified result?
          ┌────┴────┐
          yes       no
          ↓          ↓
       continue   evaluate stronger executors
                     ↓
            qualified paid/business-owned model?
                     ↓
             quote + policy + balance
                ┌────┴────┐
                preapproved  approval needed
                    ↓            ↓
                 execute      suggest + ask approval
```

## What counts as evidence that local AI may be insufficient

The escalation evaluator uses deterministic signals rather than asking the local model to judge itself.

Current signals include:

- verification failure;
- inconclusive verification;
- repeated local failures;
- repeated local attempts;
- repeated malformed structured output;
- deterministic scope-guard rejection;
- hard task class such as coding/debugging/reasoning;
- unusually large input context;
- unusually large requested output.

The evaluator produces a score and reason codes.

A model saying "I cannot do this" can be evidence, but it should not be sufficient by itself.

## Candidate executors

A candidate stronger executor should advertise:

- stable executor ID;
- provider;
- model;
- current availability;
- whether it is benchmark-qualified;
- whether it is business-owned;
- supported task classes;
- maximum input size;
- measured success rate on CoOperative evals;
- estimated marginal cost.

Later revisions should also include:

- latency;
- privacy/data-retention properties;
- regional/compliance restrictions;
- tool support;
- multimodal capabilities;
- reliability/SLA;
- current load.

## Qualification

A candidate is not selected merely because it is more expensive or marketed as more capable.

It should satisfy the task's minimum benchmark/eval floor.

The first evaluator defaults to an 80% measured-success floor when a task does not specify something higher.

Business-owned AI may be preferred when it meets the quality floor and has lower marginal cost.

For high-risk or high-value work, the required success floor should be raised.

## Spend policy

No surprise paid fallback remains a hard rule.

Platform-paid high-quality AI has an additional hard prerequisite: the authenticated CoOperative profile must have an available funded AI balance. A configured provider key, a configured model, or a positive monthly technology budget does not count as funded execution balance.

Before a platform-paid request is sent, CoOperative atomically reserves enough profile balance for the estimated request cost plus a small estimate-drift buffer. After the provider returns metered usage, CoOperative settles the actual configured cost and releases the unused reserve. Concurrent requests cannot reserve the same funds twice.

Business-owned AI is tracked separately because provider billing belongs to the connected business account rather than the CoOperative-funded balance.

The evaluator distinguishes:

- `stay-local` — insufficient evidence that escalation is warranted;
- `no-qualified-executor` — escalation is justified but no configured candidate qualifies;
- `approval-required` — a stronger executor is justified, but paid permission/cost policy does not authorize automatic use;
- `escalate` — a qualified executor is justified and fits an explicitly authorized budget, or a qualified business-owned executor has no known incremental cost.

Unknown cost is never automatically approved.

## Business-owned AI

Business-owned AI should participate in the same router.

Examples:

- local model server;
- customer AWS inference endpoint;
- enterprise API account;
- other authenticated AI capability the business already pays for.

A consumer ChatGPT, Claude, Gemini, or similar subscription must not be assumed to expose programmatic API compute.

Only supported authenticated integration paths are eligible.

## Learning loop

When a stronger model solves something local AI could not, CoOperative should retain durable learning:

- task/eval case;
- local failure evidence;
- selected executor;
- cost;
- verified outcome;
- reusable code/playbook created;
- whether future local models later pass the same case.

The goal is to reduce paid escalation over time for recurring work.

## Current implementation

Implemented in the first escalation layer:

- agent/repo reasoning now uses a bounded owned/local attempt and then a strict-free Hermes/OpenRouter route before paid escalation is suggested;
- stalled agent reasoning is cancelled before the free child job starts so a late local completion cannot overwrite the selected fallback result;

- `lib/inference/escalation-evaluator.ts`
- authenticated evaluator endpoint at `/api/inference/text/escalation`
- deterministic scoring from local failure/verification evidence;
- benchmark/capability filtering;
- business-owned preference when qualified;
- explicit paid permission;
- automatic spend ceiling;
- unknown-cost approval gate;
- first paid execution adapter for OpenAI Responses API;
- guarded execution endpoint at `/api/inference/text/escalation/execute`;
- environment-controlled qualification, benchmark, model, pricing, context, and business-owned flags;
- profile-level funded AI balances stored in micro-USD;
- atomic reserve / settle / release operations;
- an append-only credit/debit usage ledger;
- server-authoritative balance checks before platform-paid execution;
- CreatorHub stronger-model retries constrained by the user's funded profile balance.

The OpenAI adapter is inert unless it is explicitly enabled, configured, benchmark-qualified, the evaluator returns `escalate`, and the profile has enough available funded balance to cover the estimated request. Merely having an API key does not authorize paid execution.

Not yet implemented:

- fully automatic local-chat escalation after a local capability miss;
- additional platform-paid provider adapters such as Anthropic/AWS/Gemini;
- persistent per-model benchmark registry;
- customer-facing balance top-up/payment flow;
- independent verification of paid-model output.

The evaluator remains separate from provider execution so CoOperative can change GPT/Claude/Gemini/AWS/open-weight providers without changing policy logic.
