# CoOperative End-State Vision & Roadmap

Last updated: 2026-09-30

This document is the canonical bridge between CoOperative's long-term product vision and the concrete sequence of work required to reach it.

The commercial/economic north star is defined in `docs/BUSINESS-ECONOMIC-MODEL.md`: remain inside the customer's explicit budget, prove equal-or-better lower-cost replacements, report projected/verified/realized savings separately, and preserve sustainable CoOperative margin.

It should be read together with:

- `docs/PLATFORM-VISION.md`
- `docs/CORE-OPERATING-MODEL.md`
- `docs/ai/OWNER_PROFILE.md`
- `docs/ai/AI_EXECUTOR_CHARTER.md`
- `docs/LEARNING-LOOP.md`

## End-state product

CoOperative should become a conversational business operating system that continuously improves how a business operates.

A business owner should be able to connect the systems they already use and say, in effect:

> Understand how my business works, what I am paying for, what each service actually provides, and what I am trying to accomplish. Find safer, cheaper, or better ways to do it. Show me the economics and risks. Handle the approved migration or improvement with as little manual work as possible. Verify the result and keep learning from what worked.

CoOperative owns the decision process, orchestration, evidence, policies, migration logic, and customer experience.

AI models, hosting providers, SaaS vendors, cloud platforms, business-owned AI tools, human workers, and other external systems are interchangeable execution resources underneath CoOperative.

## Economic purpose

CoOperative should continuously look for measurable opportunities to:

1. protect existing revenue;
2. reduce operating cost;
3. increase current revenue;
4. create credible new revenue;
5. reduce owner/manual effort without reducing quality or control.

A core commercial pattern should be **shared realized savings** where appropriate:

```text
current business cost
  -> find a lower total-cost replacement
  -> validate equivalent/better capability
  -> migrate safely
  -> measure actual savings
  -> business keeps the majority of savings
  -> CoOperative may retain an agreed portion of realized savings
```

The exact pricing model may evolve, but CoOperative's incentives should remain aligned with improving the customer's economics.

A cheaper option is not automatically better. Compare total cost, reliability, security, support, maintenance burden, performance, feature parity, migration risk, switching cost, and business value.

## What makes CoOperative intelligent

The target is not one giant model.

Useful reasoning comes from the complete system:

```text
owner/business direction
        +
current evidence
        +
deterministic tools
        +
retrieval/memory
        +
qualified reasoning model
        +
planning
        +
verification
        +
approval policy
        +
execution tools
        +
measured outcomes
```

The model is replaceable. The durable asset is the system around it.

## Owner and business direction

CoOperative must preserve explicit operating principles as first-class machine-readable/versioned context rather than relying on scattered prompts.

The current owner direction includes:

- deterministic code/playbooks before AI;
- local/business-owned compute before unnecessary paid external compute;
- no surprise paid fallback;
- minimize unavoidable manual setup;
- optimize total value, not sticker price alone;
- preserve reliability, security, privacy, and feature parity;
- prefer reversible changes, shadow testing, and rollback;
- verify before claiming success;
- retain human approval for consequential actions;
- convert successful reasoning into reusable code, playbooks, tests, mappings, and evidence;
- models/providers are replaceable infrastructure;
- customer economic interest comes before platform/vendor incentives.

Customer-specific direction should be stored separately per tenant and merged with platform policy only for that customer's tasks.

## CoOperative reasoning envelope

Every meaningful AI reasoning request should use the policy defined in `docs/ai/AI_EXECUTOR_CHARTER.md`.

The AI Router should eventually enforce a structured envelope containing:

- objective;
- owner/business direction;
- relevant current evidence;
- prior approved decisions;
- concise current working analysis and alternatives considered;
- uncertainties/assumptions;
- cost/savings constraints;
- privacy/risk/approval boundaries;
- required output/evidence schema.

This applies to:

- local models;
- AWS-hosted models;
- CoOperative-owned models;
- customer/business-owned AI;
- connected commercial AI;
- verification models.

Third-party AI contributes reasoning. It does not become the policy authority.

## Target execution fabric

CoOperative should be hardware- and provider-independent.

```text
                     CoOperative Router
                            |
         +------------------+------------------+
         |                  |                  |
 deterministic          owned compute      connected compute
 code/playbooks              |                  |
                       +-----+------+      +-----+------+
                       |            |      |            |
                    local Mac    AWS GPU  business AI  approved API
                                                  |
                                             human workforce
                                             when required
```

Each execution target should advertise:

- supported capabilities;
- model(s);
- current availability;
- context limits;
- latency;
- marginal cost;
- privacy/data policy;
- reliability;
- benchmark quality;
- action permissions.

The router should select the lowest-marginal-cost qualified executor that satisfies the required quality, privacy, latency, reliability, and policy floor.

## Target business optimization loop

```text
connect business
  -> discover services + spend
  -> map what each service actually does
  -> identify unused/duplicated/expensive capability
  -> research alternatives
  -> compare true total cost + risk
  -> prepare migration/optimization plan
  -> verify feature parity
  -> show owner expected savings and tradeoffs
  -> obtain required approval
  -> provision replacement
  -> mirror / shadow-test
  -> migrate
  -> verify production result
  -> rollback if unhealthy
  -> cancel old cost only after confirmation
  -> measure realized savings
  -> record reusable migration knowledge
  -> continue monitoring for better options
```

CoOperative should aim to move from recommendation to execution. The value proposition is not merely "here is something cheaper"; it is "here is the better option, the evidence, the migration plan, and—after approval—I can carry it through."

## Proof-of-concept definition

The first major proof of concept is **CoOperative using its own governed reasoning stack to improve CoOperative itself**, then applying that stack to one real business migration.

### Technical proof

CoOperative can:

1. route a non-trivial reasoning task to local AI;
2. include the CoOperative reasoning envelope;
3. retrieve current evidence and tools;
4. produce a structured plan;
5. independently verify the plan;
6. prepare bounded execution steps;
7. stop at approval;
8. execute the approved change;
9. verify the result;
10. record the outcome for reuse.

### Business proof

Use a real current expense—initial candidate: the owner's father's radio-station hosting, reportedly about $1,500/year.

CoOperative should determine:

- current provider;
- exact capabilities included;
- actual annual cost;
- real usage/traffic;
- operational requirements;
- contractual/licensing constraints;
- credible alternatives;
- total replacement cost;
- migration risk;
- expected annual savings;
- rollback plan.

Then it should prepare, and eventually execute after approval, a safe migration if the economics are real.

That pilot should become the first reusable cost-optimization/migration playbook.

# Roadmap

## Phase 0 — stabilize the current local execution foundation

**Goal:** make today's Mac-based environment dependable enough to serve as the development reference implementation.

Complete:

- Local Fast text inference.
- Local Quality text inference.
- Local Vision.
- asynchronous local image generation.
- outbound queue polling.
- repo-agent branches and review gates.
- proposal review UI.

Remaining:

- resolve current Local Quality multi-reference image/IP-Adapter failure;
- improve worker/network failure recovery so SSL/transport errors cannot leave stale `running` jobs;
- ensure supervisor can detect/reconcile stale jobs automatically;
- finish proposal lifecycle beyond "Approve" into explicit create-PR / verify / merge stages;
- add cleanup for abandoned agent worktrees/jobs;
- keep deterministic health/status reporting visible.

**Exit criteria:** a local worker can run text, vision, image, and repo-agent jobs repeatedly without manual database repair.

## Phase 0.5 — production-quality Unison Windows installer

**Goal:** turn the proven Windows node bootstrap into a normal, trustworthy consumer installation experience after the first Windows node is reliably heartbeating.

Sequence:

1. prove the current Windows worker can repeatedly reach `Starting → Online/Idle` and survive restart/login on a real PC;
2. freeze the working bootstrap/repair logic instead of hiding unresolved worker bugs inside a GUI;
3. package that proven flow as a branded **CoOperative Unison Setup.exe** (or MSI where appropriate);
4. code-sign the installer with Authenticode so Windows can identify the publisher and SmartScreen friction is minimized;
5. keep installation per-user unless a future capability genuinely requires a Windows service;
6. install a lightweight Unison tray/background agent for status, pause/resume, restart, repair, update, dashboard, and uninstall;
7. preserve outbound-only node networking and per-node credentials—do not open an inbound remote-control port;
8. verify the first heartbeat before showing installation success;
9. support automatic agent/worker updates with rollback/recovery;
10. keep the raw CMD/PowerShell bootstrap only as an advanced/debug fallback.

Target user experience:

```text
Sign in to CoOperative
  → Install on this PC
  → download CoOperative Unison Setup.exe
  → double-click
  → branded install/progress
  → node pairs automatically
  → "Connected" only after a verified heartbeat
  → existing browser/session opens the contributor dashboard
```

**Exit criteria:** a normal Windows user can install, repair, restart, update, and uninstall a Unison node without manually opening PowerShell, copying pairing codes, or interacting with CMD scripts.

## Phase 1 — enforce the CoOperative reasoning layer

**Goal:** make CoOperative's direction and reasoning discipline part of runtime behavior, not documentation only.

Build:

- typed `ReasoningEnvelope` contract;
- owner/platform policy loader;
- tenant/business policy loader;
- evidence pack builder;
- uncertainty/assumption fields;
- economic constraints;
- approval/risk policy fields;
- required output schema;
- runtime enforcement in the AI Router;
- audit record showing exactly which policy/evidence revision was supplied.

Do not transmit hidden chain-of-thought. Transmit concise decision context and evidence.

**Exit criteria:** every meaningful AI route can prove which business/owner direction and evidence it received.

## Phase 2 — build CoOperative's reasoning benchmark

**Goal:** choose models by measured CoOperative performance rather than reputation.

Create a versioned eval suite covering:

- software debugging;
- infrastructure design;
- cost optimization;
- provider comparison;
- migration planning;
- security/risk identification;
- business reasoning;
- tool selection;
- evidence adherence;
- refusal to invent missing facts;
- approval-boundary recognition.

Track:

- correctness;
- evidence use;
- hallucination rate;
- plan completeness;
- tool choice;
- verification pass rate;
- latency;
- memory/VRAM requirements;
- marginal cost.

Benchmark current models and stronger open-weight candidates before promoting them.

**Exit criteria:** model/router changes require evidence that they improve the target workload.

## Phase 2.5 — governed stronger-model escalation

**Goal:** let CoOperative recognize when local reasoning is not reliable enough and deliberately select a stronger qualified executor.

Build:

- deterministic escalation scoring from verification/failure evidence;
- benchmark-qualified executor registry;
- business-owned AI candidates;
- explicit marginal-cost estimates;
- owner/tenant automatic-spend budgets;
- approval-required path when cost is unknown or above budget;
- provider-neutral execution adapter contract;
- actual-cost and verified-outcome logging;
- independent verification of escalated results.

The local model is not the sole judge of its own capability. Escalation should be based on deterministic evidence plus measured model performance.

Unknown cost must never auto-run. No surprise paid fallback remains a hard rule.

**Current progress:** deterministic evaluator and authenticated evaluation endpoint implemented; provider execution is the next layer.

**Exit criteria:** after a verified local miss, CoOperative can select a benchmark-qualified stronger executor, obtain approval when required, execute through a configured connector, and record cost + verified outcome.

## Phase 3 — stronger owned reasoning models

**Goal:** raise local/owned reasoning quality before depending on paid frontier APIs.

Work:

- benchmark larger open-weight reasoning models;
- determine practical 14B / 32B / larger thresholds for CoOperative tasks;
- maintain Fast and Quality tiers;
- keep vision/image capabilities separately replaceable;
- add quantization/model-load strategy;
- use evaluation results to decide whether additional compute is justified.

The target is not to eliminate all external AI. It is to make external AI an explicit escalation path rather than the default.

**Exit criteria:** Local/Owned Quality can successfully complete a meaningful portion of the business optimization eval suite.

## Phase 4 — migrate compute from owner Mac dependency to AWS

**Goal:** make CoOperative continuously available without requiring the owner's Mac.

Initial AWS architecture:

- CoOperative/Vercel remains the control plane initially;
- Supabase remains canonical state initially;
- AWS GPU worker becomes an additional execution target;
- persistent model cache on attached storage;
- outbound authenticated queue polling;
- no public model endpoint required;
- start/stop compute based on queued work when economically useful;
- hard budget and shutdown rules from day one.

Implement:

- containerized CUDA text worker;
- CUDA vision worker;
- CUDA image worker;
- repo-agent/runtime worker as appropriate;
- worker capability registration;
- health/heartbeat;
- queue leasing;
- stale-job recovery;
- Mac/AWS routing and failover;
- cost-per-job accounting.

**Exit criteria:** text, vision, image, and a reasoning-agent task can complete through AWS with the Mac turned off.

## Phase 5 — business-owned and third-party AI connections

**Goal:** let a business contribute AI compute it already owns or pays for.

Build an AI Connector contract that records:

- provider;
- supported programmatic access;
- model/capabilities;
- authorization;
- billing owner;
- marginal cost;
- privacy/retention behavior;
- context/modality limits;
- benchmark results;
- availability.

Examples may include:

- a customer's local GPU/model server;
- a customer-owned AWS model endpoint;
- an approved enterprise AI/API account;
- other authenticated model providers.

Do not assume consumer ChatGPT/Claude subscriptions expose API compute. Use only supported integration methods.

Every such call must inherit the CoOperative reasoning envelope and policy gates.

**Exit criteria:** a qualified customer-owned model can be added to the router and used for an eval task without changing the playbook.

## Phase 6 — Connected Services & Cost Discovery

**Goal:** automatically understand what a business currently pays for and why.

Build:

- bill/subscription discovery;
- provider/service catalog;
- recurring cost normalization;
- service capability mapping;
- observed usage/feature map;
- contracts/renewal metadata where available;
- duplicate/unused capability detection;
- total-cost calculation;
- confidence/evidence fields.

Inputs may come from:

- connected financial data;
- email invoices/receipts;
- provider APIs;
- uploaded contracts/bills;
- owner confirmation;
- discovered infrastructure.

Sensitive financial/customer data stays tenant-isolated.

**Exit criteria:** CoOperative can produce an evidence-backed "Current Business Stack & Cost Map."

## Phase 7 — Cost Optimization & Migration Planner

**Goal:** turn the service map into executable savings opportunities.

For each candidate service:

- research credible alternatives;
- prefer native/deterministic/self-hosted options when sensible;
- compare feature parity;
- estimate infrastructure and maintenance;
- model migration cost;
- model downtime/rollback risk;
- calculate gross and expected realized savings;
- identify human/vendor constraints;
- generate a reversible migration plan.

Outputs should use structured schemas rather than free-form recommendations.

**Exit criteria:** CoOperative can generate a validated migration proposal with economics, evidence, risks, and rollback.

## Phase 8 — Migration Execution Engine

**Goal:** safely perform approved migrations.

Capabilities:

- provider provisioning;
- connector/bootstrap;
- data export/import;
- schema mapping;
- config transfer;
- shadow environment;
- reconciliation;
- health checks;
- DNS/traffic cutover where applicable;
- rollback;
- old-service cancellation gate;
- post-migration monitoring.

No cancellation of the old provider until the replacement is verified and the required human approval is satisfied.

**Exit criteria:** one real migration completes with measured before/after cost and a tested rollback path.

## Phase 9 — first real business pilot: radio station

**Goal:** prove customer savings, not just technical capability.

Steps:

1. identify current radio hosting provider;
2. obtain exact plan/bill;
3. inventory streaming, AutoDJ, storage, scheduling, listener stats, licensing/reporting, support, domains/certificates, and uptime requirements;
4. measure actual bandwidth/listener demand;
5. compare AWS and credible non-AWS alternatives;
6. model full annual cost;
7. prepare migration + rollback;
8. shadow-test;
9. obtain approval;
10. migrate;
11. verify listener/operational parity;
12. measure realized savings;
13. turn the process into a radio-hosting migration playbook.

**Exit criteria:** verified annual savings while preserving required station functionality.

## Phase 10 — Savings, Budget & CoOperative Balance Ledger

**Goal:** make customer budgets, funded CoOperative balance, economic value, and platform margin measurable and enforceable without misaligned incentives.

Track:

- baseline cost;
- expected replacement cost;
- actual replacement cost;
- migration one-time cost;
- gross savings;
- realized savings;
- business-retained savings;
- CoOperative fee/share where contractually applicable;
- reliability/service outcome after migration.

Do not charge savings-share fees on hypothetical savings that were not realized.

**Exit criteria:** a customer can see exactly where savings came from and how CoOperative's compensation was calculated.

## Phase 11 — human workforce execution layer

**Goal:** route tasks that genuinely need human action to paid human workers while keeping the task simple and mobile-friendly.

Use humans when:

- physical-world action is required;
- policy requires a human;
- AI/tool automation cannot reliably complete the step;
- the human economic case is better than current outsourced labor.

Workers should receive:

- clear task scope;
- step-by-step instructions;
- required evidence;
- compensation;
- deadline;
- completion/verification flow.

This remains another execution provider beneath CoOperative, not a replacement for the optimizer.

## Phase 11.5 — owner-reviewed AI improvement reports

**Goal:** let CoOperative use its own qualified models to review accumulated platform evidence and continuously prepare improvements for owner approval.

Build:

- comprehensive execution telemetry across Chat, agents, Unison nodes, providers, costs, failures, verification outcomes, and human interventions;
- an Improvement Report compiler routed to owned/local models first;
- evidence-backed summaries of recurring failures, wasted tokens/compute, routing mistakes, provider/model performance, reusable reasoning patterns, and opportunities to replace AI with deterministic code;
- bounded proposal generation for code, playbooks, routing, evals, prompts/context, connectors, and curated model-training candidates;
- owner-dashboard Chat cards for **Approve / Deny / Defer / Tell me more**;
- isolated branch/PR generation for approved code/playbook changes;
- curated training/eval dataset generation for owned models;
- benchmark gates requiring an improved model to beat the current production model before promotion;
- strict tenant/privacy boundaries so raw customer data is not silently pooled into shared model training;
- no autonomous merge, deployment, or model promotion beyond explicit policy/approval.

Owned/local models are the default report compilers when qualified. Stronger paid models are escalation candidates only when policy, benchmark evidence, budget, and approval allow them.

**Exit criteria:** the owner can open the Owner Dashboard chat, review an evidence-backed improvement report created primarily by CoOperative-owned models, ask follow-up questions, approve selected changes, and have those approved changes enter the normal guarded build/eval pipeline.

## Phase 12 — autonomous improvement flywheel

**Goal:** common business improvements become progressively cheaper and more reliable.

```text
first case
  -> AI-heavy discovery
  -> human review
  -> scripts + mappings + tests
  -> measured outcome

next cases
  -> reuse playbook
  -> deterministic work
  -> AI for exceptions
  -> better evidence

mature case
  -> mostly automated
  -> predictable cost
  -> guarded execution
  -> human only at consequential gates
```

The strongest long-term advantage is not owning a particular model. It is owning the accumulated migration intelligence, capability maps, code, policies, evidence, benchmarks, economic data, and verified playbooks.

## Conversation-first business workspace

**Goal:** make chat the primary business control surface while preserving deterministic policy, approvals, evidence, and execution underneath it.

Target shell:

- conversations remain the center of the experience;
- a business/project selector establishes the active tenant and initiative;
- connected services and available capabilities are discoverable beside chat;
- Budget & Savings shows baseline spend, CoOperative balance, hard budget ceiling, current managed spend, and savings state;
- Approvals collects consequential or paid actions;
- Activity/Evidence explains what ran, what it cost, why it was routed there, and how it was verified;
- chat receives the active business's relevant service map, economic envelope, policies, and project state through a bounded reasoning context.

The interface may borrow familiar interaction patterns from modern AI assistants, but CoOperative's differentiator is that chat can inspect, propose, execute, verify, and report against real business economics.

**Exit criteria:** a business owner can stay primarily in chat while understanding and acting on projects, connected services, budgets/savings, approvals, and execution evidence without navigating unrelated technical dashboards.

# Near-term priority order

Until changed by a new explicit owner decision, prioritize:

1. stabilize current Mac/local workers and agent recovery;
2. prove the first Windows Unison node is reliably heartbeating, then build the branded signed Unison Windows installer/tray agent described in Phase 0.5;
3. finish the current image/agent test loop;
4. implement runtime Reasoning Envelope enforcement;
5. finish the governed escalation evaluator and connect the first stronger executor;
6. build CoOperative eval/benchmark harness and use it to qualify escalation candidates;
7. benchmark stronger open-weight reasoning models;
8. build AWS execution target and prove Mac-independent inference;
9. add business-owned AI connector contract;
10. build service/cost discovery;
11. build migration planner/executor;
12. run the radio-station cost-optimization pilot;
13. add verified-savings ledger/business model;
14. build owner-facing owned-model Improvement Reports and approval flow in Owner Dashboard chat;
15. expand into broader business migrations and human-workforce execution.

# Non-goals

Do not:

- rewrite working products merely to centralize them;
- migrate Vercel/Supabase/AWS infrastructure without measured benefit;
- optimize solely for the cheapest sticker price;
- make a specific AI provider foundational to the platform;
- treat consumer AI subscriptions as unauthorized API access;
- silently spend customer/owner money;
- give AI broader operational permissions simply because it is more capable;
- train on raw private tenant data by default;
- cancel a working provider before replacement verification;
- claim savings before they are measured.

# Success definition

CoOperative reaches the intended end state when a business owner can connect their business, provide goals and constraints, and CoOperative can reliably:

1. understand the current operation;
2. identify meaningful economic opportunities;
3. reason using the business's direction and current evidence;
4. choose the best qualified compute/tool/provider;
5. prepare a safe improvement or migration;
6. obtain human approval at the right boundary;
7. execute with minimal owner effort;
8. verify and roll back when necessary;
9. measure real business value;
10. learn the reusable parts so the next similar job is cheaper and easier.
