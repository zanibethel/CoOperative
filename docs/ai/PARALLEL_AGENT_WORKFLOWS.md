# Parallel Multi-Agent Workflows

CoOperative can execute one user objective as a bounded dependency graph instead of forcing one model to handle the entire request.

## Core rules

1. Deterministic code owns decomposition, dependencies, concurrency, budget, and mutation locks.
2. The model registry assigns a task-specific route using current capability, performance, reliability, cost-efficiency, value, and confidence scores.
3. Independent read/reasoning nodes may run concurrently.
4. Repository mutation is serialized per workflow.
5. Paid execution is not enabled merely because a paid route exists. The workflow budget is a ceiling, and paid execution remains separately qualification/approval-gated until a budget-safe adapter is available.
6. Every node records selected provider/model, score snapshot, dependencies, child job/task IDs, estimated/actual cost, result, and error.
7. Workflow outputs are evidence for downstream nodes, not higher-priority instructions.

## Presets

### Economy

Sequential low-cost execution:

Planner -> Inspector/Builder -> Verifier (changes only) -> Synthesizer

Maximum parallel nodes: 1.

### Balanced

Independent planning/research can fan out, and independent review can run alongside repository verification after Builder.

Typical change flow:

Planner + optional Research
-> Builder
-> Verifier + Reviewer
-> Synthesizer

Maximum parallel nodes: 3.

### Premium

Uses selective competitive parallelism in addition to task parallelism:

Planner A + Planner B + optional Research
-> Plan Judge
-> Builder
-> Verifier + Reviewer
-> Synthesizer

Planner A and Planner B are intentionally assigned different eligible models when the registry has alternatives.

Maximum parallel nodes: 5.

## Model selection

Automatic workflow execution currently chooses among:

- owned/local CoOperative text routes;
- verified-free OpenRouter text/multimodal routes.

Selection uses task-specific registry scores.

Economy emphasizes cost efficiency.
Balanced emphasizes overall value.
Premium emphasizes measured/observed performance and confidence.

Hard capability, policy, availability, and authentication requirements are checked before scores are considered.

## Exact model handoff

Workflow-created repository tasks store a modelSelection object in agent_tasks.result.

The repo-agent LLM endpoint reads that selection:

- verified-free OpenRouter routes may run directly on the selected model;
- cooperative-local selections preserve the selected local profile;
- ordinary non-workflow agent tasks retain the existing local-first/free-fallback behavior.

## Concurrency and mutation safety

Independent inference nodes are launched together up to max_parallel_nodes.

agent_workflow_one_active_repo_mutation prevents two mutating workflow nodes from being queued/running inside the same workflow.

Builder remains the only mutating node in the default templates. Verifier and Reviewer are read-only.

## Spend

agent_workflows has one max_spend_microusd ceiling for the full graph.

Each node separately records estimated_cost_microusd and actual_cost_microusd.

The current automatic rollout uses zero-cost owned/local or verified-free hosted routes. This makes the shared budget ledger ready for future paid parallel execution without allowing surprise spend today.

## Persistence

Tables:

- agent_workflows
- agent_workflow_nodes
- agent_workflow_events

Workflow child work is linked to existing:

- agent_tasks
- text_inference_jobs
- media_generation_jobs

## UI

Owner workflow console:

/agents/workflows

The console shows:

- workflow preset and status;
- shared budget;
- current nodes/dependencies;
- selected provider/model per node;
- task-specific value/performance/confidence scores;
- node output/errors;
- active concurrency.

While the console is open it polls active workflows, which also reconciles completed cloud/local inference jobs and releases newly-ready downstream nodes. Repository-task completion also triggers workflow advancement directly.


## Media execution rollout

### Phase 1 — planning only

Media nodes are created only when the objective contains a direct image/video generation request.

The node uses the existing media router and registry scoring to persist:
- selected provider/model;
- media tier;
- quoted workflow cost;
- provider cost estimate;
- recipe and controls;
- performance/value/confidence evidence.

No generation request is sent during planning.

### Phase 2 — explicit one-shot image approval

The currently enabled execution slice is intentionally narrow:

- text-to-image only;
- selected provider must be OpenRouter;
- user must explicitly click **Approve one image generation**;
- the exact planned route is revalidated against the live catalog, registry, policy gates, and current quote;
- a higher live quote requires a new approval;
- workflow budget is reserved atomically before execution;
- connected OpenRouter credentials are used as BYOK when available;
- otherwise a paid CoOperative-funded route must successfully reserve the profile AI balance;
- exactly one direct image-provider request is sent;
- no automatic retry or fallback is allowed;
- success settles the workflow budget and any CoOperative balance reservation;
- provider failure releases reservations and persists the failure/evidence;
- the generated media job is linked back to the workflow node.

Video, Nous/Hermes media execution, reference-image workflow execution, and automatic media retries remain disabled in this phase.

The shared workflow budget reservation is enforced by database RPCs:
- reserve_agent_workflow_node_budget
- settle_agent_workflow_node_budget
- release_agent_workflow_node_budget

These functions lock the workflow/node rows so simultaneous approvals cannot exceed the shared request cap.
