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
- `allowPaidFallback` is only a recorded permission for a future escalation layer.
- The current router never executes a hosted fallback automatically.
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

## Next layer

The next layer should add result verification and escalation policy. A local result should only escalate when verification indicates a real miss and policy allows the additional provider/cost. Hosted execution must remain explicit and auditable.
