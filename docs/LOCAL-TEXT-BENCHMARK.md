# Local text benchmark

CoOperative AI promotes local language models based on measured performance on our own work, not model release date alone.

## Profiles

### Local Fast
- Default model: `mlx-community/Qwen3-4B-Instruct-2507-4bit`
- Runtime: MLX on Apple Silicon
- Purpose: quick chat, summaries, planning, routine coding assistance, first-pass reasoning
- No per-request model API fee
- Environment override: `TEXT_FAST_MODEL_ID`

### Local Quality
- Default model: `mlx-community/Qwen2.5-7B-Instruct-4bit`
- Runtime: MLX on Apple Silicon
- Purpose: harder coding, debugging, multi-step planning, higher-quality drafting
- No per-request model API fee
- Environment override: `TEXT_QUALITY_MODEL_ID`

The initial target is the current 16 GB M1 Mac. Do not assume a larger model is better until it passes this benchmark within the machine's memory and latency limits.

## Benchmark set

Run the same tasks against Fast, Quality, the current stable local model, and any proposed replacement.

1. **Repository debugging**
   - Give a compact TypeScript build failure plus surrounding code.
   - Measure whether the model identifies the actual type/control-flow problem and proposes a minimal safe fix.

2. **Architecture planning**
   - Ask for a concrete implementation plan for a CreatorHub/CoOperative feature with cost and permission constraints.
   - Measure completeness, unnecessary complexity, and adherence to existing architecture.

3. **Code generation**
   - Request a small Next.js route with Zod validation and explicit authorization.
   - Verify the code compiles and does not weaken auth or expose secrets.

4. **Operational summary**
   - Provide a mixed status log and ask for current state, blocker, and exact next action.
   - Measure factual fidelity and whether it invents work that did not happen.

5. **Long-context retrieval**
   - Provide a bounded project context with one critical constraint buried near the beginning.
   - Verify the model preserves that constraint in the final answer.

6. **General assistant quality**
   - Ask a non-code planning/writing task.
   - Check clarity, instruction following, and whether the response is useful without excessive verbosity.

## Record for each run

- model ID and profile
- prompt tokens and output tokens
- first-token/total latency when available
- total latency
- peak memory if available
- task success/failure
- factual correctness
- instruction adherence
- code/build/test outcome where applicable
- whether escalation to a hosted model was required
- owner correction or approval

## Promotion rule

A candidate can replace a default only after it materially improves the target workload without unacceptable memory, latency, reliability, license, or safety regressions.

Keep the previous stable model available for rollback.

Model discovery may be automated, but downloading/promoting a large replacement should remain governed so CoOperative does not unexpectedly consume storage, memory, bandwidth, or paid compute.

## Learning loop

A local miss can become an evaluation case:

```text
local attempt
  -> verify result
  -> escalate when policy allows
  -> capture corrected/better result and evidence
  -> add a sanitized evaluation case
  -> improve retrieval/prompt/tooling first
  -> optionally train an adapter only when rights permit
  -> rerun benchmark
  -> promote or reject
```

Do not blindly train on every conversation or every hosted-model response. Private tenant data stays isolated, and model/provider licensing must allow the intended training or distillation use.
