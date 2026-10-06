# AI Model Capability Registry

CoOperative maintains a service-side, versioned registry of AI model routes across cloud providers, owned/local runtimes, and future integrations.

## Purpose

The registry exists so routing decisions can use current evidence rather than static assumptions. It tracks:
- model/route identity and availability;
- text, image, video, vision, multimodal and local-runtime capabilities;
- reference/edit support and media controls;
- pricing and limits;
- provider/model policy metadata;
- runtime outcomes and controlled capability tests;
- benchmark/runtime summaries;
- when a model first appeared, last appeared, changed, disappeared or returned.

Adult-content capability is one scoped dimension of the registry, not the registry itself.

## Database

### ai_model_registry
Current canonical state for each unique provider/model/endpoint/route-kind.

### ai_model_capability_evidence
Append-only capability evidence. New observations are added instead of deleting old observations. Evidence may come from:
- live provider catalogs;
- provider/model documentation;
- controlled capability tests;
- runtime success/failure;
- benchmarks;
- local runtime/node evidence;
- manually reviewed evidence.

### ai_model_scan_runs
One row per scanner execution, including source coverage and counts.

### ai_model_scan_changes
Per-scan history of new, updated, restored and missing routes.

All four tables are service-side and protected by RLS with no client policies.

## Scanner

Core implementation:
- `lib/inference/model-capability-registry.ts`

API:
- `GET /api/inference/models/scan` — current registry + latest scan metadata.
- `POST /api/inference/models/scan` — run a fresh scan.

CLI:
- `npm run models:scan`

CLI environment:
- `COOPERATIVE_BASE_URL`
- `COOPERATIVE_INFERENCE_SHARED_SECRET`

## Current discovery sources

The scanner currently discovers:
- OpenRouter live image models;
- OpenRouter live video models;
- OpenRouter live text/multimodal models;
- Nous managed image/video routes;
- CoOperative local text profiles;
- CoOperative local vision model;
- owned-node text runtime backends;
- specialized media/edit/reference routes already represented by capability evidence.

New provider adapters should normalize into the same route snapshot shape rather than adding provider-specific routing tables.

## Evidence and learning

Existing media runtime outcomes and controlled capability tests mirror into the general evidence table.

Examples of capability keys include:
- adult-content;
- reference-fidelity;
- identity-preservation;
- request-shape-image-reference;
- runtime-provider-policy;
- runtime-retryable-technical.

Evidence includes source, scope, confidence, timestamp and structured metadata.

Routing may use positive or negative evidence only according to the scope that evidence actually covers. A result for one endpoint, input shape or content scope must not be generalized to unrelated routes.

## Change semantics

A scan computes a fingerprint over normalized route state.

- new: not previously in registry;
- updated: fingerprint changed;
- restored: previously missing and now present;
- missing: absent from a successfully scanned provider/route category.

A provider outage must not mark unrelated route categories missing. Missing detection is scoped to provider + route kind.

## Adult-content capability

Keep separate scoped states such as:
- adult non-explicit;
- adult explicit;
- reference-image + adult non-explicit;
- reference-image + adult explicit.

Each state should retain:
- allowed / disallowed / unknown;
- evidence source;
- evidence scope;
- checked/tested time;
- controlled test or runtime job reference when applicable.

Provider-policy outcomes are evidence, but should not be confused with technical failures or capability mismatches.

## Safety and spend

Capability scanning should prefer metadata/documentation discovery first.

Any active generation benchmark or capability test must remain an explicitly controlled test with:
- normal spend caps;
- no silent retry/fallback;
- exact provider/model/endpoint identity;
- persisted outcome and scope.

The general scanner itself should not incur generation spend.


## Automatic refresh

Production runs the registry scan once daily through Vercel Cron:

- route: `/api/inference/models/scan/cron`
- schedule: `0 13 * * *`
- authentication: `CRON_SECRET`
- configuration: `vercel.json`

The owner dashboard at `/models` includes a manual **Scan now** control and current route coverage.

The daily scanner is metadata/catalog based and should not incur generation spend. A separate monitor can review `ai_model_scan_runs` and `ai_model_scan_changes` and surface only meaningful changes.

## Model Mixer registry integration

The Model Mixer consumes the same persisted `ai_model_registry` used by routing and scoring. It does not maintain a separate hand-curated list of model names.

The authenticated `GET /api/inference/models` endpoint exposes the current registry snapshot to the Mixer with execution availability derived from the connected provider state, CoOperative AI balance/BYOK state, and route execution readiness. The UI ranks candidates per agent role using the persisted task scores:

- Research: `general-text`
- Planner: `reasoning`
- Builder: `coding`
- Verifier: `reasoning`
- Media: `image-generation` and `video-generation`

Slider levels change the ranking emphasis from free/cost-efficient to performance/quality. Level 0 excludes paid hosted routes. Higher levels may surface paid routes, but display eligibility never authorizes spending by itself.

Final execution remains bounded by the request-level spend ceiling, provider connection, live node availability, BYOK or funded AI balance, capability fit, policy evidence, adult-content scope, exact media controls, and runtime fallback rules. This keeps the registry authoritative for discovery and scoring without allowing the Mixer UI to bypass execution safeguards.

