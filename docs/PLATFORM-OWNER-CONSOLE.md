# CoOperative Platform Owner Console

## Purpose

CoOperative needs two distinct owner experiences:

1. **Business Owner Console** — the tenant-scoped operating surface for a customer/business.
2. **Platform Owner Console** — CoOperative's internal operating system for the platform owner and future authorized internal staff.

These must not be conflated.

The Platform Owner Console should borrow the strongest patterns already proven in RaiseHub's Owner Platform while adapting them to CoOperative's broader role as an AI/business operating system.

## Core identity model

The platform owner's authenticated identity remains permanent.

```text
Actor (platform owner)
  -> Platform role/capabilities
  -> Selected organization/project/workspace
  -> Support/operation mode
  -> Resource/task
  -> Audit event
```

Selecting a customer, managed project, or workspace must never impersonate that user or mutate the platform owner's saved identity.

## Access model

Do not hard-code an email address as the authorization mechanism.

Target model:

- Supabase authenticated user identity;
- explicit platform-role membership tied to user ID;
- granular internal capabilities;
- server-side authorization;
- RLS/application checks reinforcing one another.

Potential roles:

- `platform_owner`
- `platform_admin`
- `support_operator`
- `read_only_auditor`

Initial rollout may contain only `platform_owner`, but the capability model should allow later delegation.

## Platform Owner Console areas

### Overview
- platform health;
- active organizations;
- managed projects;
- operative tasks;
- pending decisions;
- recent failures/incidents;
- current cost envelope;
- savings/revenue impact;
- deployment/connectivity status.

### Managed Projects
- RaiseHub;
- CreatorHub;
- Camp Rise Again;
- future connected projects;
- service stack;
- deployment state;
- costs;
- risks;
- improvement opportunities;
- improvement history.

### Organizations / Customers
- search organizations;
- open tenant context;
- inspect configuration;
- inspect connected services;
- inspect task/memory history;
- enter read-only support mode.

### Support Mode
Default: read-only.

May allow:
- inspect organization state;
- review conversations/tasks;
- inspect connected-service state;
- inspect failures and audit history;
- diagnose problems.

It must not silently grant write access.

### Assisted Operations
Privileged writes must be explicitly enabled for:
- selected organization/project;
- current session;
- defined action class.

Require:
- platform-owner authorization;
- reason/context;
- capability check;
- policy check;
- audit entry;
- additional confirmation for higher-risk actions.

### Mission Control
- operative task queue;
- executor selected;
- model/provider selected when AI is required;
- current state;
- cost cap;
- actual marginal cost;
- task evidence;
- retry/fallback history;
- pause/cancel/resume where policy allows.

### AI / Executor Router
- current available models/providers;
- model health/availability;
- cost table;
- fallback chain;
- task quality floor;
- owner overrides;
- Hermes usage;
- deterministic/playbook usage;
- sandbox runtime usage.

Provider/model details should remain optional in normal customer experiences but visible to the platform owner.

### Connectors
- provider catalog;
- connection health;
- OAuth/app setup status;
- requested scopes;
- token/credential-reference status;
- webhook state;
- connector failures/deprecations;
- Connector Factory backlog.

Never display secret values.

### Costs & Economics
- fixed platform subscriptions;
- per-task AI cost;
- sandbox/compute usage;
- email/SMS/storage/API cost;
- customer cost-to-serve;
- gross-margin alerts;
- measured savings;
- measured revenue impact.

### Audit & Memory
- Owner Intent & Change Audit;
- task events;
- decisions/approvals;
- support actions;
- privileged writes;
- model/executor routing decisions;
- structured memory provenance;
- superseded policies/decisions.

### Platform Settings
- feature flags;
- policy defaults;
- executor/model routing rules;
- cost thresholds;
- supported capabilities;
- approval requirements;
- managed-project modes.

## Workspace/project browser

Borrow RaiseHub's workspace-browser model.

The platform owner should be able to search/select:

- organizations;
- managed projects;
- connected businesses;
- internal/demo workspaces.

Opening a workspace changes **context**, not identity.

Example:

```text
PLATFORM OWNER
Viewing: RaiseHub
Mode: Managed Project / PR-only
Production writes: gated
```

or:

```text
PLATFORM OWNER SUPPORT MODE
Viewing: Customer Organization X
Mode: Read-only
```

## Read-only by default

Cross-tenant/project access should start read-only.

Writes require an explicit privileged mode and should remain scoped.

Do not create a permanent global "admin bypass" experience simply because the backend possesses a server secret.

## High-risk actions

Require stronger owner gates for:

- production deployment;
- database/RLS/auth changes;
- secrets;
- money movement;
- billing;
- customer-data export;
- destructive operations;
- identity/role changes;
- widening OAuth scopes;
- executor authority expansion;
- Telegram/other channel cutovers.

## Audit principles

Privileged operations should record:

- actor user ID;
- target organization/project/workspace;
- action;
- resource;
- reason;
- before/after when appropriate;
- task/decision linkage;
- channel;
- timestamp;
- result;
- rollback/evidence.

Support notes and audit events remain separate:
- support note = context/follow-up;
- audit event = what actually changed.

## Customer Owner Console relationship

A business customer should not see platform-wide controls.

Customer Owner Console:
- their business;
- their connected tools;
- their tasks;
- their opportunities;
- their approvals;
- their costs/usage;
- their memories/policies.

Platform Owner Console:
- all authorized tenants/projects;
- platform infrastructure;
- support;
- routing;
- platform economics;
- managed projects;
- connectors;
- privileged operations.

## Near-term implementation order

1. Define platform-role/capability schema and migration for review.
2. Add server-side `requirePlatformOwner()` authorization helper.
3. Create `/owner` route separate from tenant `/console`.
4. Add platform overview + managed-project cards.
5. Add workspace/project browser.
6. Add read-only organization/project inspection.
7. Add Mission Control task/decision/cost views.
8. Add audit timeline.
9. Add explicitly gated assisted-operation mode.
10. Add global search and support notes.
11. Add model/executor/router controls.
12. Expand to delegated internal roles only when needed.

Any auth/RLS/database change remains an explicit owner gate before application.
