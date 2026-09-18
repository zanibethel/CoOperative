# Managed Projects

## Purpose

CoOperative should be able to manage and improve software/business projects without absorbing them into the CoOperative repository.

A managed project remains its own product, repository, deployment, database, integrations, and business model.

CoOperative becomes the intelligence/orchestration layer that:

- understands the project's architecture and operating policies;
- inventories infrastructure and recurring costs;
- observes health, reliability, usage, and business outcomes;
- identifies improvement opportunities;
- creates Decision Briefs;
- routes approved work to the lowest-marginal-cost qualified executor;
- verifies outcomes;
- records savings, revenue impact, reliability gains, and lessons;
- converts successful improvements into reusable playbooks.

## Core rule

> Managed projects stay independent. CoOperative manages and improves them through governed connectors.

Do not merge customer/project codebases into CoOperative simply to make them manageable.

## Managed project record

Each project should eventually track:

- name;
- repository;
- production URL(s);
- hosting provider/project;
- database/auth provider/project;
- email provider;
- payment provider;
- storage;
- AI/model providers;
- domains/DNS;
- monitoring/logging;
- approximate fixed monthly cost;
- variable usage cost;
- business KPIs;
- environment separation status;
- production-write policy;
- connected capabilities;
- current risks;
- improvement opportunities;
- improvement history;
- measured savings/revenue/reliability outcomes.

## Improvement modes

A managed project may be placed in progressively stronger modes:

### Observe
Read-only architecture, cost, health, and business analysis.

### Propose
Generate structured improvement opportunities and Decision Briefs.

### PR-only
Prepare governed code branches/PRs and run CI/preview verification.

### Assisted operations
Perform explicitly approved operational changes with audit evidence.

### Governed autonomy
Run pre-approved low-risk playbooks automatically within defined cost/risk limits.

Projects should earn stronger modes through evidence. Do not default to broad write access.

## Improvement contract

Every proposed project improvement should include:

- problem/opportunity;
- evidence;
- expected benefit;
- expected cost;
- risk;
- executor recommendation;
- AI required or not;
- owner approval requirement;
- implementation plan;
- measurement plan;
- rollback/stop condition.

## Executor economics

For owner-managed projects, prefer:

1. deterministic scripts/playbooks;
2. connected ChatGPT/tooling when qualified and lower marginal cost;
3. native CoOperative capability;
4. Hermes/Cloud Operative for shell/runtime/background/autonomous work;
5. additional paid AI only for unresolved reasoning.

All executors must write results back to the canonical CoOperative task/evidence history.

## Learning loop

Each accepted project improvement should feed:

```text
observe
-> identify opportunity
-> estimate economics
-> approve
-> execute
-> verify
-> measure
-> generalize lesson
-> improve playbook
```

The objective is for future projects to receive the same class of improvement with less AI reasoning and lower implementation cost.
