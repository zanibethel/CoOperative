# Media Benchmark Framework

Status: Active implementation plan  
Last updated: 2026-10-03

## Purpose

CoOperative should choose media execution recipes from evidence rather than model price or branding alone.

The routing scorecard separates:
- live/current cost;
- content-policy/capability evidence;
- observed output quality;
- prompt adherence;
- anatomy;
- reference fidelity;
- edit strength;
- speed.

Unknown evidence remains unknown. Do not invent scores to fill gaps.

## Stored benchmark dimensions

`media_model_benchmarks` stores exact-route observations by:
- owner/profile;
- provider;
- model;
- endpoint;
- benchmark suite;
- dimension;
- normalized score from 0–100 when measured;
- measured/inconclusive status;
- source type;
- optional source media job;
- raw measurement metadata;
- notes and timestamp.

Initial dimensions:
1. `visual_quality`
2. `prompt_adherence`
3. `anatomy`
4. `reference_fidelity`
5. `edit_strength`
6. `speed`

## Routing behavior

For SFW requests:
- adult capability does not change model eligibility or score;
- quality benchmarks replace catalog-tier heuristics as evidence accumulates;
- unmeasured quality dimensions fall back to current catalog/model-tier evidence and must be labeled heuristic.

For non-explicit adult requests:
- Allowed excludes known-blocked routes but does not automatically prefer verified routes;
- Prefer gives a modest tie-breaking/ranking advantage to exact routes verified for the requested adult scope;
- Require allows only exact routes verified for that scope.

For explicit adult requests:
- non-explicit capability evidence is insufficient;
- exact-route explicit-scope verification remains required.

## Quality composite

Text-to-image weighting:
- visual quality: 40%
- prompt adherence: 35%
- anatomy: 25%

Reference/edit weighting:
- visual quality: 25%
- prompt adherence: 20%
- anatomy: 15%
- reference fidelity: 25%
- edit strength: 15%

If only part of the weighted evidence has been measured, CoOperative blends the measured evidence with the existing catalog-tier heuristic according to benchmark coverage. The UI must show whether the routing quality score is:
- measured;
- mixed evidence;
- heuristic.

Speed remains visible as its own benchmark dimension. It should not silently overpower requested quality unless a future routing policy explicitly assigns it weight for a speed-sensitive request.

## Current evidence

Exact adult non-explicit route evidence currently includes:
- Nous / `fal-ai/z-image/turbo`: supported for `adult_non_explicit_boundary`;
- Nous / `fal-ai/nano-banana-pro`: supported for `adult_non_explicit_boundary`.

These tests establish only that capability scope. They do not create quality, reference-fidelity, anatomy, prompt-adherence, edit-strength, or explicit-adult scores.

## Next controlled benchmark work

Do not benchmark every model indiscriminately.

First compare the two currently useful text-to-image routes on the same standardized SFW prompts so routing can answer whether the higher-cost route materially improves output.

Recommended first suite:
1. prompt adherence / composition constraints;
2. anatomy and hands;
3. overall visual quality;
4. measured end-to-end speed.

After that, benchmark reference-capable edit routes separately using a fixed reference asset and score:
- identity/reference fidelity;
- requested edit strength;
- prompt adherence;
- visual quality.

Every paid benchmark must still:
- show the current estimate and safe cap;
- require explicit user approval;
- make one exact-route generation call;
- use no retry/fallback;
- persist the source job;
- record inconclusive rather than inventing a score when evaluation is not reliable.
