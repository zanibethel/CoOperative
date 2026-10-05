# Local text routing

CoOperative AI routes text work above the existing persistent local queue. The queue and Apple Silicon worker remain unchanged.

## Rules

- Manual `local-fast` always queues the Fast profile and never permits paid fallback.
- Manual `local-quality` always queues the Quality profile and never permits paid fallback.
- `auto` stays local and chooses a profile deterministically:
  - coding, debugging, reasoning, and long-context tasks -> Quality
  - requests above 1024 requested output tokens -> Quality
  - requests above 12,000 estimated input characters -> Quality
  - otherwise -> Fast
- `allowPaidFallback` is a permission input to the governed escalation layer.
- Repo/connector agents use a bounded owned/local reasoning window. If that path is unavailable, fails, or stalls, CoOperative tries strict-free Hermes/OpenRouter before paid AI is considered.
- Free fallback runs as a separate child inference job after the stale local job is cancelled, preventing a late local completion from overwriting the chosen fallback result.
- CoOperative now has a deterministic escalation evaluator that can decide whether a stronger business-owned or paid executor is justified.
- Paid AI is never the first fallback. When free reasoning is insufficient, the governed escalation layer can recommend a stronger model; paid execution still requires the applicable explicit approval, quoted spend policy, and funded balance.
- `humanApprovalRequired` is preserved as an execution-governance flag. It does not prevent the local model from analyzing or drafting a proposed action.

## Registry

The server registry selects profiles rather than assuming the Mac's exact model ID. Each profile has a default model and an environment override:

- Fast: `mlx-community/Qwen3-4B-Instruct-2507-4bit` / `TEXT_FAST_MODEL_ID`
- Quality: `mlx-community/Qwen2.5-7B-Instruct-4bit` / `TEXT_QUALITY_MODEL_ID`

The worker reports the actual model used when the job completes.

## Persisted routing evidence

Each routed job records:

- routing mode
- task class
- route reason
- whether paid fallback was permitted
- whether later execution requires human approval
- model-registry revision
- verification status

This gives CoOperative evidence for future benchmarking and promotion/rollback without blindly retraining model weights.

## Escalation layer

The first governed escalation evaluator is implemented in `lib/inference/escalation-evaluator.ts` and exposed through the authenticated `/api/inference/text/escalation` endpoint.

It uses deterministic evidence such as verification failure, repeated local failures, structured-output failures, scope-guard rejection, task class, and context size. It then filters candidate executors by availability, benchmark qualification, task support, context capacity, and cost policy.

Decisions are one of:

- stay local;
- no qualified stronger executor;
- ask for approval;
- escalate within an explicitly authorized budget.

Unknown paid cost requires approval. Business-owned AI can be preferred when it is qualified and has no known incremental cost.

See `docs/AI-ESCALATION.md`.

The next execution layer is to connect qualified external/business-owned executors and record actual per-call cost and verified outcome.
