# CoOperative Cloud Operative

## Goal

Move the platform-operating role currently performed by a Hermes installation on a Mac into CoOperative-managed cloud infrastructure while preserving the same core doctrine:

- playbooks and deterministic code first;
- AI only when needed;
- interchangeable models/providers;
- least-privilege access;
- explicit owner approval for high-risk actions;
- strict cost control;
- reusable learning from every successful setup.

The end state should not require the owner's MacBook to remain awake or online.

## Primary owner experience: Owner Console

The primary control surface should be a CoOperative **Owner Console**, not Telegram.

The Owner Console is a conversational dashboard where the business/platform owner can:

- talk naturally with an integrated AI advisor;
- ask what is happening across the business/platform;
- review Hermes/Cloud Operative proposals;
- understand technical decisions in plain language;
- see expected cost, savings, revenue impact, risk, and confidence;
- approve, reject, edit, pause, or cancel work;
- inspect pending owner decisions;
- see task progress and completed outcomes;
- review cost usage and plan margin;
- continue a decision thread without copy/pasting between tools.

Telegram is secondary: useful for alerts, urgent approvals, and lightweight mobile interaction, but not the canonical owner experience.

### Decision Brief

Any action that needs owner input should be normalized into a Decision Brief:

- **What is being proposed**
- **Why it is needed**
- **What happens if approved**
- **What happens if declined or delayed**
- **Expected cost**
- **Expected savings/revenue impact**, when applicable
- **Risk level**
- **Permissions/scopes required**
- **Rollback/stop condition**
- **Recommended next action**
- **Approve / Reject / Modify / Ask a question**

The AI advisor should explain the brief conversationally without changing the underlying policy or approval requirement.

### AI advisor vs executor

The conversational AI is an advisor/orchestrator, not an unrestricted executor.

It may:

- explain;
- summarize;
- compare;
- ask clarifying questions;
- translate technical details;
- propose changes;
- create governed operative tasks;
- surface pending approvals.

Execution still flows through:

`policy -> playbook/script -> capability router -> operative task -> approval gates`

No model may bypass the policy layer simply because it is embedded in the Owner Console.

### Conversation continuity

Owner conversations should persist as structured CoOperative state, not depend on a single model/provider's hidden memory.

Store durable items such as:

- owner decisions;
- stated business goals;
- approved policies;
- rejected approaches;
- decision rationale where useful;
- open questions;
- task references;
- linked evidence.

The AI model can change without losing the owner's operating context.

## Target experience

The owner should be able to use the Owner Console from phone or desktop:

```text
Owner
  -> CoOperative Owner Console
  -> integrated AI advisor
  -> durable conversation + business/platform context
  -> Cloud Operative task
  -> policy + cost + permission check
  -> playbook / script / connector
  -> AI only when reasoning is required
  -> cloud execution workspace when terminal/code work is required
  -> result + evidence + artifacts
  -> Decision Brief only at genuine owner gates
  -> owner approves/rejects/edits in the same conversation
```

Telegram and future ChatGPT/plugin connections should enter the same task/approval system rather than creating separate authority paths.

## Existing infrastructure first

Prefer the infrastructure already attached to CoOperative before adding another recurring service.

### GitHub

Use for:

- application code;
- playbooks;
- connector definitions;
- schemas/contracts;
- documentation;
- tests;
- reviewed platform changes.

GitHub is source control, not the long-running execution environment.

### Vercel

Use for:

- CoOperative web application;
- Owner Console UI and APIs;
- authenticated APIs;
- Telegram/webhook entry points;
- orchestration endpoints;
- scheduled/event-driven execution;
- Vercel Sandbox for isolated terminal/code execution;
- preview deployments and verification;
- AI Gateway/model routing where useful.

The Cloud Operative should prefer on-demand execution over paying for an idle always-on server.

### Supabase

Use for durable structured state:

- organizations/businesses;
- owner conversations and decisions;
- operative tasks and task status;
- approvals;
- task events/audit trail;
- connected-service metadata;
- capability/playbook metadata;
- cost ledger;
- outcomes/evidence;
- generalized learning artifacts.

Use Supabase Storage for private persisted files/artifacts when appropriate.

Do not store secrets in normal database rows or storage objects.

## Cloud Operative components

### 1. Owner Console / Task Intake

Primary source:

- CoOperative Owner Console conversation.

Secondary sources may include:

- Telegram webhook;
- admin action;
- scheduled research task;
- Improvement Lab proposal;
- GitHub issue explicitly approved for execution;
- future ChatGPT/CoOperative connector.

Every task receives a durable task ID and links back to the decision/conversation that created it.

### 2. Task Policy Layer

Before execution, determine:

- tenant/platform scope;
- requested action class;
- risk level;
- owner approval requirement;
- required capabilities;
- maximum spend;
- timeout/retry rules;
- rollback requirements.

### 3. Playbook Engine

Look for a known approved procedure before asking AI to plan the task.

Examples:

- configure Vercel public env values;
- provision OAuth connector;
- rotate a connector version;
- run provider research;
- prepare a preview deployment;
- test and report a migration.

### 4. Script / Function Library

Use deterministic implementations for repeatable work.

Scripts should be reusable across models and agents.

### 5. AI Router

Call AI only for steps requiring interpretation, research synthesis, generation, debugging, or planning.

The playbook requests a capability, not a hard-coded model.

Select the cheapest approved model meeting quality requirements and cost envelope.

### 6. Execution Workspace

For tasks requiring a shell, repository checkout, tests, CLIs, or code execution:

- create or resume an isolated Vercel Sandbox;
- check out only the necessary repository;
- inject only required scoped credentials;
- restrict network access where practical;
- execute the approved playbook;
- persist only intentional artifacts/state;
- stop/snapshot the sandbox after work.

A sandbox is an execution workspace, not the authoritative database.

### 7. Durable Task State

Task state belongs in Supabase, not only inside the sandbox.

Suggested state machine:

```text
queued
  -> planning
  -> awaiting_approval
  -> executing
  -> verifying
  -> completed

or

  -> blocked
  -> failed
  -> rolled_back
  -> cancelled
```

### 8. Artifact Storage

Initial storage plan:

- GitHub: source-controlled durable knowledge;
- Supabase Postgres: structured task/evidence/conversation data;
- Supabase Storage: task artifacts, reports, fixtures, generated files, backups that are appropriate for object storage;
- Vercel Sandbox filesystem: temporary execution state only.

Possible private buckets:

- `platform-artifacts`
- `connector-fixtures`
- `operative-reports`
- `generated-assets`
- `hermes-migration`

Create buckets only as they become necessary and protect them with tenant/platform-specific policies.

### 9. Secrets

Use secure runtime secret/environment systems.

Never store raw secrets in:

- GitHub;
- issues;
- task logs;
- normal Supabase tables;
- ordinary Storage objects.

Tasks should refer to secrets by logical name/reference only.

### 10. Telegram

Telegram should eventually use a webhook into CoOperative instead of requiring a continuously running Mac gateway.

Target flow:

```text
Telegram
  -> authenticated CoOperative webhook
  -> create/view operative task
  -> receive Decision Brief or status
  -> approve/reject if allowed
  -> execute asynchronously
  -> post result back
```

The Telegram identity must be allow-listed and mapped to the appropriate CoOperative owner account.

Telegram does not have independent authority; it uses the same Owner Console/task policy.

### 11. External ChatGPT bridge

A future CoOperative connector/plugin may allow ChatGPT to use the same governed task interface.

Expose only controlled operations such as:

- create task;
- read task status/result;
- list pending approvals;
- submit an explicit owner-approved decision;
- cancel task;
- read cost/usage summaries.

Do not expose unrestricted shell access.

This preserves the option for the owner to keep working with ChatGPT while CoOperative remains the authoritative task/policy system.

## Hermes migration strategy

The current Hermes installation is a bootstrap platform operative.

It should help build the system that removes its dependency on the owner's Mac.

Migration phases:

### Phase A — inventory

Hermes inspects its current configuration and identifies:

- skills/playbooks worth preserving;
- task/kanban state worth migrating;
- Telegram configuration;
- GitHub/Vercel/Supabase access patterns;
- model-provider configuration;
- files/state that should NOT be migrated.

No secret values should be placed in reports.

### Phase B — build cloud primitives

Create:

- Owner Console conversation/decision contracts;
- operative task schema;
- task-event/audit schema;
- approval schema;
- Decision Brief contract;
- cost ledger integration;
- cloud execution adapter;
- artifact-storage abstraction;
- Cloud Operative service/interface;
- Telegram webhook as secondary interface.

### Phase C — self-bootstrap

Hermes uses the new infrastructure to perform a real platform task.

Examples:

- inspect repo;
- create isolated execution workspace;
- make a low-risk code/config change;
- run tests;
- save report/evidence;
- pause with a Decision Brief;
- continue after owner approval.

### Phase D — cut over phone control

Owner Console becomes the primary mobile control surface.

Verify:

- owner conversation creates a task;
- task persists;
- execution runs while Mac is offline;
- owner receives understandable status/Decision Brief;
- approval/resume works from the same dashboard.

Telegram can then be connected as an optional notification/backup interface.

### Phase E — retire Mac dependency

Once cloud operation is stable:

- Mac Hermes becomes optional development/backup tooling;
- no production/platform task requires the Mac to be awake;
- old Telegram gateway may be disabled;
- preserve an export/backup only where useful.

## Self-bootstrap success criteria

The Cloud Operative pilot is successful when:

1. the owner can initiate a task from the CoOperative Owner Console on a phone;
2. the Mac can be offline;
3. the task is durably recorded in Supabase;
4. the conversation/decision that created it is preserved;
5. the system selects an existing playbook/script first;
6. a cloud execution workspace is created only when required;
7. AI is used only for genuinely reasoning-dependent steps;
8. cost is measured;
9. high-risk actions pause with a clear Decision Brief;
10. the owner can ask questions before approving;
11. approve/reject/modify resumes the same task safely;
12. artifacts/evidence are persisted intentionally;
13. the task completes and reports back in the Owner Console;
14. the resulting procedure is reusable for the next task.

## Cost rule

Do not add a traditional VPS solely for convenience while existing event-driven infrastructure satisfies the requirement at lower expected cost.

A persistent server may be introduced later only when measured usage shows that it is cheaper, more reliable, or technically required.

## Non-goals for the first version

Do not attempt to:

- self-host a large LLM;
- give Hermes unrestricted production access;
- move secrets into the database;
- create a permanent always-on VM without demonstrated need;
- migrate every piece of local Hermes state;
- auto-merge high-risk platform changes;
- make Telegram the primary owner interface;
- bind Owner Console intelligence to one model provider.

The first goal is a safe, durable, conversational, phone-controlled cloud operative that can progressively replace manual platform glue work.
