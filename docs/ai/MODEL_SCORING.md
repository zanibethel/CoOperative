# Model Performance and Value Scoring

CoOperative maintains task-specific scores for execution-ready routes in the AI model registry.

## Goals

The scoring layer helps routing compare models on more than price or provider name. It separates:

- capability fit;
- measured quality;
- technical reliability;
- observed speed;
- cost efficiency;
- evidence-weighted performance;
- overall value;
- confidence.

A model can rank differently by task. There is no single universal leaderboard.

## Tasks

Current task classes:

- general-text
- summary
- coding
- reasoning
- vision
- image-generation
- image-reference
- video-generation

## Stored state

Current scores live in `ai_model_task_scores`.

Each row includes:

- capability_fit_score
- quality_score
- reliability_score
- speed_score
- performance_score
- cost_efficiency_score
- overall_value_score
- confidence
- benchmark/runtime/latency sample counts
- benchmark coverage
- representative task cost
- score version and calculation timestamp
- structured source summary

The current task score map is also rolled into
`ai_model_registry.score_summary` for fast routing reads.

## Evidence

### Capability fit

Derived from the route's current normalized capabilities and task requirements.

Examples:

- image-reference requires image/reference input or an edit route;
- vision requires image input;
- coding receives additional fit credit for reasoning, structured output,
  tool calling, and long context;
- reasoning receives additional fit credit for explicit reasoning support and
  long context.

Capability metadata does not pretend to be measured output quality.

### Quality

Measured quality is used when controlled benchmark evidence exists.

Current media dimensions include:

- visual quality
- prompt adherence
- anatomy
- reference fidelity
- edit strength
- speed

Image generation uses weighted visual-quality, prompt-adherence, and anatomy
evidence.

Reference-image workflows additionally weight reference fidelity and edit
strength.

Unbenchmarked routes have a null measured quality score rather than a fabricated
quality number.

### Reliability

Reliability uses real execution history from the rolling 90-day window.

Tiny samples are Bayesian-smoothed so a single successful call does not become
100/100 certainty.

Content-policy refusals, capability mismatches, and executor-policy outcomes are
excluded from technical reliability. They remain separate routing/policy
evidence.

### Speed

Speed uses observed completed-request latency where available and is normalized
against comparable routes for the same task.

Unknown latency remains unknown.

### Cost efficiency

Cost is normalized within each task class.

Free/owned-local routes score highest on cost efficiency.

Paid routes are ranked on a log scale so small price differences among cheap
models matter without letting very expensive routes dominate the entire range.

Representative text costs use fixed task token assumptions so models are
compared on the same workload rather than provider marketing units.

Representative image/video costs use normalized live catalog pricing.

Provider sentinel prices such as negative/unknown values are treated as unknown,
never as negative cost.

## Confidence

Sparse evidence is explicitly penalized through confidence.

Unknown performance does not become either excellent or terrible by default.
Scores are shrunk toward neutral (50) until benchmark/runtime evidence
accumulates.

Confidence increases with:

- benchmark coverage and samples;
- runtime reliability samples;
- latency samples;
- known comparable cost.

## Composite scores

Performance is based on available evidence with these target weights:

- capability fit: 20%
- measured quality: 45%
- reliability: 20%
- speed: 15%

Unavailable dimensions are not replaced by invented measurements; the available
weights are re-normalized and the result is confidence-shrunk toward neutral.

Overall value is approximately:

- 75% evidence-weighted performance
- 25% cost efficiency

and is again confidence-aware.

## Routing use

Hard constraints always come first:

1. capability/input requirements;
2. provider/model policy;
3. live availability;
4. authentication/connection;
5. budget/spend ceiling.

Scores rank only the routes that survive those gates.

Current routing usage:

- free hosted text fallback ranks eligible free models by task-specific value
  and confidence;
- media Balanced/automatic within-cap selection uses registry value as an
  evidence-aware signal;
- High-end media continues to prioritize measured quality;
- Lowest-cost media continues to prioritize price.

A high score never overrides a hard policy, capability, availability, or spend
constraint.

## Refresh behavior

Every model capability scan recalculates the full score registry from current:

- pricing;
- catalog capabilities;
- benchmark evidence;
- 90-day runtime history.

Saving new benchmark reviews also triggers an immediate score refresh.

The score version is currently `2026-10-05.1`.
