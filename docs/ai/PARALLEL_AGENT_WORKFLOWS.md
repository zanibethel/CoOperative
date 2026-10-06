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
