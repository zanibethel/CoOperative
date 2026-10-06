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
- the confirmed owned explicit image success is persisted in `ai_model_capability_evidence` as runtime evidence, while visual quality remains intentionally unscored until benchmark evidence exists;
- image queue jobs now persist `pipeline_mode`, `pipeline_trace`, and `required_capabilities`;
- queue claiming is capability-aware, so a pipeline or explicit job is not handed to a worker that does not advertise the required execution features;
- the first executable pipeline is wired as **base generation -> local quality judge -> targeted low-strength refinement when indicated -> deterministic local upscale**;
- successful pipeline stages mirror back into `ai_model_capability_evidence`, preserving the learning loop.

### quality-v1 activation

The first pipeline is intentionally conservative.

It activates only when:

1. the request selects the high-end owned/local quality image route;
2. there is no reference-image handoff for this first version;
3. an authorized node advertises `composable_media_pipeline_v1`.

The worker advertises that capability beginning with `image-worker-0.11.0`. Until an updated worker heartbeats with that capability, routing remains on the existing single-pass path rather than queueing work that an older node cannot execute.

The current quality judge is explicitly a **heuristic image-signal judge**, not a semantic anatomy critic. It measures detail, contrast, and resolution and uses prompt intent to prioritize human-detail refinement. Its trace sets `semanticAnatomyAssessment=false` so future semantic vision specialists can replace it without confusing the evidence.

The first upscaler is Pillow/Lanczos. That is a cheap portable component and a useful pipeline placeholder, not a learned super-resolution model. The component contract allows it to be replaced independently when a stronger local or hosted upscaler is verified.

### Semantic Vision Judge v1

The next quality layer is now implemented as a separate owned/local vision stage rather than being embedded inside the diffusion worker.

After a successful `quality-v1` image completes:

1. the image job queues an internal `media-judge` text/vision job targeted to the same owned node;
2. the MLX vision worker securely downloads only that completed image artifact;
3. `mlx-community/Qwen2.5-VL-3B-Instruct-4bit` returns a structured semantic report for prompt adherence, faces, hands, anatomy, skin, lighting, background integrity, and artifact severity;
4. the control plane validates the JSON contract before accepting it;
5. the accepted report is appended to the image job's `pipeline_trace.semanticJudge`;
6. successful runtime evidence is recorded as `semantic-quality-judge / semantic-vision-v1`.

The judge is local-only in this first version. It is created with `allow_paid_fallback=false` and `routing_preference=require-node`, so a missing local judge cannot silently spill into paid cloud inference.

The source image endpoint is also job-scoped: a node can read the generated artifact only while it owns the matching running semantic-judge job.

This stage does not yet mutate the image. Its first purpose is to give the repair planner a trustworthy semantic diagnosis. A failed or unparseable judge report leaves the generated image intact and records the judge stage as failed rather than pretending the inspection succeeded.

Next implementation layer:

1. smoke-test `semantic-vision-v1` on the same controlled benchmark image and validate its structured findings;
2. convert semantic findings into a bounded repair plan instead of always running generic human-detail refinement;
3. add a learned local super-resolution specialist and compare it with the current Lanczos component;
4. add region masks / inpainting for face, hand, anatomy, skin, and background repairs;
5. allow the planner to choose local specialists plus bounded cloud specialists within the Model Mixer ceiling.

More stages should be added only when evidence shows they improve output enough to justify their time and cost.
