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

## Hermes / Nous managed media discovery

CoOperative now scans the media model catalog shipped by the exact pinned Hermes release used by the media worker (`v2026.9.24` by default, overrideable with `HERMES_MEDIA_RELEASE`). This avoids maintaining a second hand-curated copy of the Nous/Hermes media universe.

Discovery reads the release-pinned Hermes image catalog and FAL video-family registry. Routes are persisted under provider `nous`, with the Hermes release and source catalog recorded in registry metadata.

Execution readiness is deliberately stricter than discovery:

- Fixed per-image prices can become eligible for automatic text-to-image routing, subject to the normal Model Mixer spend ceiling, connected Nous entitlement, policy evidence, and runtime checks.
- Per-megapixel models remain discoverable but non-executable until request dimensions allow CoOperative to bound the total provider cost. A per-MP number must never be treated as a whole-image quote.
- Token-priced or otherwise unbounded image routes remain discoverable but non-executable until pricing can be bounded.
- Image edit/reference endpoints are persisted separately and remain non-executable until the existing exact-route reference verification flow approves them.
- Hermes video families are discovered with their capabilities and limits, but remain non-executable until request-specific live pricing is available. The existing live-priced PixVerse route remains the current automatic Nous video path.
- Catalog-only models receive only low-confidence provisional cost/value scores. CoOperative does not infer quality from price. Runtime and benchmark evidence replace these provisional scores as evidence accumulates.

A provider-side rejection or missing managed proxy does not finalize the user request. Runtime evidence is recorded for the exact route and normal fallback routing continues within the user's approved capability, content-policy, and spend constraints.

## Request cost resolver and execution reconciliation

Media model ranking and execution share `lib/inference/model-cost-resolver.ts`. Provider catalog unit prices are never compared directly to the Model Mixer spend cap.

The resolver normalizes each candidate to the total cost of the current request. Supported pricing shapes include free, fixed/request-level estimates, per-image, per-megapixel, per-second, and per-second-by-resolution/audio. Unsupported or incomplete pricing remains unbounded and cannot authorize a paid provider call.

For Hermes/FAL image routes priced per megapixel, the resolver maps the current Hermes aspect bucket to the pinned release's native image preset, converts pixels to 1024×1024 billing megapixels, and rounds conservatively so CoOperative does not under-quote the provider cost. The generic registry score uses one billing megapixel only as a low-confidence representative ranking cost; the actual request price is always recalculated from the request controls.

Cost reconciliation happens twice:

1. Recommendation/Mixer ranking resolves provider cost for the request and derives the effective cap cost. When CoOperative bears the paid provider cost, `paidAiPriceQuote()` applies the configured markup to produce the user-facing quote. BYOK or subscription-backed routes use provider cost for cap enforcement but do not create a CoOperative user charge.
2. Immediately before funds are reserved or a provider call begins, CoOperative reloads current pricing for the selected route and runs the same resolver again. If the price is unbounded, stale, or above the approved request cap, execution stops without reserving funds or calling the provider.

The existing `media_generation_jobs` ledger remains authoritative. Its `pricing_dimensions` payload stores both the recommendation-time estimate and the execution-time `costResolution` breakdown, while the existing estimated/actual provider cost, user charge, and margin columns support later quote-versus-actual reconciliation. No parallel billing ledger is introduced.

## Live Hermes video pricing

Hermes video families remain discoverable from the pinned Hermes release, while execution eligibility is derived from current provider pricing at request time.

`nousManagedMediaCatalog()` now loads the current FAL model page for each Hermes text-to-video endpoint and normalizes only pricing forms that can be bounded safely:

- per-second rates by resolution;
- separate audio-off/audio-on per-second rates;
- flat per-second rates when the provider explicitly states that resolution/audio does not change the price;
- provider-native resolution labels such as `768p` or `4k`;
- approximate/token-derived per-second rates only with a 5% conservative routing buffer.

A video family is exposed to automatic Mixer routing only when its current pricing can be converted into a bounded total for the exact duration, resolution, and audio controls. Unknown pricing, incomplete audio-toggle pricing, unsupported request controls, or stale/missing provider pages keep the family visible in the registry but non-spendable.

Recommendation-time pricing and execution-time pricing use the same `model-cost-resolver.ts` path. Immediately before execution, CoOperative reloads the live Nous/Hermes catalog and reconciles the selected route again. If the price no longer fits the Model Mixer cap, or can no longer be bounded, no provider call begins.

The registry scanner persists successful live video pricing under `pricing.rates` with `unit=second` and `requestCostResolverRequired=true`. Runtime and benchmark evidence remains separate from pricing evidence; a lower price never implies higher output quality. Promotional provider rates are intentionally refreshed from the live page rather than pinned indefinitely.

Explicit output controls are capability constraints, not preferences. For example, a native/always-on-audio video model is excluded when the request explicitly requires no audio.

