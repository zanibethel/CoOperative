# Composable Media Pipeline

CoOperative is moving from single-model media routing toward a composable rendering pipeline where each model or local component contributes the part of the request it is best at.

The goal is not to split proprietary cloud models into internal layers. Hosted providers generally expose only their supported inputs and outputs. Instead, CoOperative composes independently executable specialists through stable artifacts such as images, masks, pose maps, depth maps, segmentation maps, embeddings, prompts, and quality reports.

## Core principle

A request should be treated as a graph of capabilities, not as a single model choice.

A high-quality image request may eventually resolve to a pipeline such as:

```text
request
  -> prompt / scene planner
  -> composition or pose stage
  -> base generator
  -> candidate judge
  -> targeted face / anatomy / lighting / background refinement
  -> upscale
  -> final verifier
```

Any stage may be local, an owned node, a Unison node, or a bounded hosted-provider call.

The Model Mixer remains the request-level quality/cost ceiling. The planner should spend only where a specialist materially improves the requested result.

## Artifact handoffs

Cross-model handoff should prefer portable artifacts:

- prompt / structured scene description;
- reference image;
- generated image;
- mask;
- pose map;
- depth map;
- segmentation map;
- embedding where the consuming route explicitly supports it;
- quality report / scored findings.

Raw latent tensors are not assumed to be portable. A provider-native latent may be passed only when both producer and consumer advertise the exact same compatibility key for the latent representation.

The executable contract lives in:

- `lib/inference/media-pipeline-contract.ts`

That contract defines artifact compatibility, specialist capability keys, execution locality, content-class compatibility, and deterministic candidate ranking.

## Capability vocabulary

Initial specialist capabilities include:

- prompt planning;
- composition;
- pose control;
- depth control;
- segmentation;
- base generation;
- candidate generation;
- reference fidelity;
- identity preservation;
- face detail;
- anatomy;
- hands;
- skin texture;
- lighting;
- background detail;
- inpainting;
- outpainting;
- upscaling;
- quality judging;
- final verification.

This list is intentionally capability-oriented. A full image model may satisfy several capabilities; a small local model, LoRA, ControlNet-style adapter, upscaler, detector, or verifier may satisfy only one or two.

## Registry model

The existing general registry remains authoritative.

Executable specialists should use the same registry/evidence system rather than a separate hard-coded catalog:

- `ai_model_registry` stores the executable route/component identity;
- `ai_model_capability_evidence` stores scoped proof for specialist capabilities;
- `ai_model_task_scores` stores task-specific performance/value scores;
- media benchmarks provide measured quality dimensions;
- runtime outcomes provide reliability and latency evidence.

`ai_model_task_scores.task_type` is text, so component-specific scores can use the stable convention:

```text
media-component:<capability>
```

For example:

```text
media-component:face-detail
media-component:anatomy
media-component:upscaling
media-component:quality-judge
```

No new database enum is required to begin learning these specialties.

## Local-first selection

For each stage, the planner should:

1. enforce request/content constraints and exact artifact compatibility;
2. exclude routes that are not execution-ready;
3. stay inside the remaining request spend ceiling;
4. rank by measured quality, reliability, confidence, and cost efficiency;
5. prefer same-device / owned / Unison execution when quality is competitive;
6. use a hosted specialist only when it adds enough value to justify the spend.

Free/local is a preference, not a reason to accept a visibly worse final result when the user selected a higher quality target and approved the spend.

## Candidate generation + judging

A useful cost-saving pattern is:

```text
several cheap local candidates
  -> quality judge
  -> select best candidate
  -> spend refinement budget only on the winner
```

This allows CoOperative to use local compute for breadth and reserve premium calls for the one image most likely to benefit.

## Learning loop

Every executed stage should eventually record:

- exact component route;
- requested capability;
- input/output artifact contract;
- latency;
- provider/infrastructure cost;
- success/failure;
- user-visible result;
- benchmark/verifier scores;
- downstream usefulness.

That evidence should feed component task scores so the planner improves rather than relying permanently on hand-written preferences.

## Current implementation status

Phase 1 foundation is now in place:

- a typed portable-artifact/component contract exists;
- deterministic specialist eligibility and ranking exists;
- owned local image jobs are included in general model runtime scoring, so local successes/failures contribute to reliability evidence instead of being invisible to the registry;
- the confirmed owned explicit image success is persisted in `ai_model_capability_evidence` as runtime evidence, while visual quality remains intentionally unscored until benchmark evidence exists.

Next implementation layer:

1. expose real local specialist components such as upscaling, inpainting/detail repair, pose/depth conditioning, and quality judging as capability nodes;
2. register and score them;
3. have media recommendation building produce a multi-stage plan rather than only one generation route;
4. execute the plan behind a feature gate;
5. compare pipeline output against the current single-model baseline before making it the default.

The first live pipeline should remain simple: **local base generation -> quality judge -> targeted refinement -> upscale**. More stages should be added only when evidence shows they improve output enough to justify their time and cost.
