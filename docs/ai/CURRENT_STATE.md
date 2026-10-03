# CoOperative AI Current State

Last updated: 2026-10-02

## Proven local inference

### Images
Persistent asynchronous local image generation is proven end to end through the outbound-polling Mac worker.

Profiles:
- Local Fast: `stable-diffusion-v1-5/stable-diffusion-v1-5`
- Local Quality: `segmind/SSD-1B`

The image worker can continue after CreatorHub closes and return the completed result later.

### Text
Persistent asynchronous local text generation is proven end to end through the outbound-polling MLX Mac worker.

Profiles:
- Local Fast: `mlx-community/Qwen3-4B-Instruct-2507-4bit`
- Local Quality: `mlx-community/Qwen2.5-7B-Instruct-4bit`

Warm benchmark observed during initial validation:
- Local Fast short response: about 2.8 seconds
- Local Quality short response: about 14.3 seconds

Cold runs were much slower because of first download/model load.

### Vision
Local image understanding is implemented through:
- `mlx-community/Qwen2.5-VL-3B-Instruct-4bit`
- `mlx-vlm`
- private authenticated image attachments
- persistent image-grounded conversations

The worker keeps one inference model resident at a time to protect the 16 GB M1 memory budget.

## Chat
Local AI currently supports:
- persistent authenticated conversations;
- reopen/resume;
- Local Fast / Local Quality;
- image attachments and follow-up image context;
- live partial response progress;
- Stop/cancellation;
- model, latency, token, and time-to-first-token metadata;
- no paid fallback from manual Local mode.

## Routing
CoOperative has a local model registry and deterministic local-first routing metadata. Jobs record routing reason, task class, paid-fallback permission, human-approval requirement, registry revision, and verification status.

## Next active layer
Agent runtime v1:
- bounded agent definitions;
- explicit owner/project memory;
- approved repo registry;
- outbound-polling local repo worker;
- deterministic repo tools first;
- Local AI used only when repo reasoning/generation is needed;
- isolated branches and verification before any future push/deploy.


## Media routing

Current media behavior now includes:
- deterministic parsing/preflight before generation;
- a default $0.05 testing/request ceiling unless explicitly changed;
- live-priced High / Medium / Low recommendation cards after a clear ask;
- exact-request video pricing across duration/resolution/audio where supported;
- Nous/Hermes preference before OpenRouter paid fallback when capability is verified;
- owned/local image and reference-image routes;
- new-task boundaries that prevent unresolved video/image requests from contaminating later media asks;
- retry logic that targets the newest unresolved relevant media request before older completed jobs;
- execution-truthfulness rules that prevent text models from claiming a generation started when runtime state did not confirm it.

The canonical product requirements and acceptance tests are in `docs/ai/MEDIA_ROUTING_POLICY.md`.

### Reference-image premium discovery

A read-only backend discovery layer now exists at `/api/inference/media/reference-models`.

It:
- uses Hermes `v2026.9.24` edit-endpoint metadata as the capability boundary;
- checks current fal pricing pages live and refuses to substitute stale prices when parsing fails;
- distinguishes model/reference capability from connected Nous authorization;
- explicitly reports the Nous managed-gateway allowlist as **not probed** because Step 1 performs no generation/provider spend;
- does not alter recommendation cards or execution routing yet.

Initial curated discovery covers GPT Image 2.5 Sunburst/Flare Edit, Nano Banana Pro/2 Edit, FLUX 2 Pro/Klein reference editing, and Qwen Image 2 Pro Edit.

### Reference-image recommendation cards

The verified discovery output is now wired into reference-image High / Medium / Low recommendation building.

Current boundary:
- live-priced Hermes/Nous reference-capable models may appear in the cards;
- High prefers the strongest precision/reference capability available;
- Medium finds a distinct quality/cost compromise;
- Low remains the cheapest valid route, often owned/local;
- premium discovery-only cards show reference behavior and verification status;
- those premium cards are intentionally non-executable in this step;
- existing owned/local reference-image execution remains unchanged.

### Nous reference transport verification

Reference-image recommendation preflight now performs a zero-generation verification pass for the connected Nous path.

It verifies:
- the refreshed Nous OAuth authorization is usable;
- the live Nous Portal account snapshot currently grants managed FAL access through paid access or covered tool-pool entitlement;
- the managed FAL gateway host is reachable;
- every current reference attachment belongs to the authenticated owner;
- each attachment can be represented by a short-lived HTTPS signed URL and fetched successfully without exposing that URL to the client.

This step still does **not** submit a model job. Hermes' pinned managed-FAL integration does not expose a documented zero-spend per-model allowlist/billing-meter preflight, so per-model gateway acceptance remains explicitly unproven until a user approves the first real generation.

Premium cards remain non-executable. Their verification note now distinguishes a transport-ready route from one blocked by account entitlement, gateway reachability, or attachment handoff.

### Premium reference smoke-test route

One premium reference-image route is now eligible for an explicitly selected, one-shot smoke test:

- Hermes model: `openai/gpt-image-2.5/sunburst/text-to-image`
- actual edit endpoint: `openai/gpt-image-2.5/sunburst/edit`

The card becomes executable only when the same request's zero-generation Nous transport verification is ready. Selection remains explicit through the recommendation card and the quoted request cap is enforced before submission.

Execution rules:
- the current authenticated reference attachment is converted to a fresh short-lived server-side HTTPS URL only after selection;
- Hermes is instructed to pass the first URL as `image_url` and any remaining URLs as `reference_image_urls`;
- exactly one configured image-generation call is allowed;
- no automatic retry, provider fallback, or Recovery Agent launch occurs for this smoke test;
- the media job records `referenceSmokeTest` plus the exact edit endpoint in `pricing_dimensions`;
- completion proves that exact endpoint accepted and completed the reference-image route;
- failure is recorded against that exact endpoint and returned directly.

All other discovered premium reference-image models remain display-only.

### Persisted premium reference verification

Premium reference endpoint verification is now durable per CoOperative owner/profile.

A new `media_reference_model_verifications` table records:
- provider;
- model;
- exact edit endpoint;
- verified/failed state;
- source media job;
- verification timestamp;
- last attempt;
- failure detail.

The successful GPT Image 2.5 Sunburst smoke test was backfilled as verified from its completed media job.

Recommendation behavior now:
- a previously verified endpoint becomes normally executable when the current Nous auth/gateway/attachment transport checks pass;
- a previously failed unverified endpoint remains blocked;
- the single first-time Sunburst smoke path still exists for profiles that have not verified it yet;
- all other premium reference models remain display-only until separately tested.

Execution behavior now:
- verified premium reference jobs still receive fresh short-lived reference URLs;
- successful reference jobs refresh durable verification state;
- a later transient failure does not erase an already verified endpoint;
- failed reference routes do not auto-fallback to a path that may ignore the reference image.

### Second premium reference smoke-test route

FLUX 2 Pro Edit is now the second isolated premium reference model eligible for a one-shot verification:

- Hermes model: `fal-ai/flux-2-pro`
- actual edit endpoint: `fal-ai/flux-2-pro/edit`

Sunburst remains the only persistently verified premium reference route on the current profile. FLUX 2 Pro becomes selectable only when current Nous transport checks pass and there is no existing verification record for that endpoint.

The same smoke-test rules apply:
- explicit card selection;
- quoted cap enforced before submission;
- current authenticated reference image preserved;
- one generation attempt;
- no automatic retry;
- no provider fallback;
- no Recovery Agent launch;
- result persisted against the exact edit endpoint.

No other premium reference model is newly enabled.

### Next media implementation layer

Run and inspect one FLUX 2 Pro reference-image smoke test. If it succeeds and visibly honors the reference image, its existing verification persistence path will promote it to normal executable use. If it fails, keep it blocked with the recorded endpoint failure. Do not unlock a third model until that result is reviewed.


### Media content compatibility preference and capability learning

A profile-level media output preference now exists with four stored modes:
- `sfw_only` (default);
- `adult_allowed`;
- `prefer_adult_capable`;
- `require_adult_capable`.

Model Mixer presents this as an **NSFW** checkbox:
- unchecked by default = keep generated output SFW;
- unchecked does **not** exclude adult-capable models from SFW work;
- checking NSFW expands three radio options and defaults to **Adult content allowed**;
- the user can then select **Prefer adult-capable models** or **Require adult-capable models**;
- NSFW modes require explicit 18+ acknowledgment.

The preference is stored in `personal_ai_settings`. This UI/semantics update still does **not** change recommendation routing yet.

Two capability-learning tables now exist:
- `media_model_capabilities` for provider/model/endpoint capability and published-policy metadata;
- `media_model_capability_tests` for owner/profile-specific observed test outcomes.

Initial premium reference models are seeded with their known reference capability from Hermes, while adult-content policy remains `unknown` until a current policy source or controlled test establishes more.

Observed tests can record:
- adult-content support or blocking;
- reference fidelity;
- identity preservation;
- edit strength;
- provider/policy behavior;
- other model-specific observations.

The authenticated read-only endpoint `/api/inference/media/capabilities` exposes the current preference, model capability metadata, and the latest observed tests for the active owner/profile. It explicitly reports that routing is not yet using the preference.

### Next content-compatibility implementation layer

After the preference UI/metadata is verified, teach recommendation building to filter or prefer models according to the profile setting while still enforcing provider rules, model capability truthfulness, and hard safety boundaries. Adult-capability tests should be recorded as observed capability evidence, not treated as permission to bypass provider or platform restrictions.


### Model Mixer execution-recipe semantics

Model Mixer is now explicitly defined as an execution-recipe controller rather than a simple model selector.

For media, future recommendation/routing decisions should jointly consider:
- model/provider;
- output type/workflow;
- output quality and model-specific generation settings;
- resolution/aspect ratio;
- duration/audio where applicable;
- reference fidelity/identity behavior where applicable;
- cost and time;
- user content constraints and other request requirements.

Agent levels remain quality/cost ceilings. The best route is the best complete output configuration within those constraints, not automatically the most expensive or highest-tier model.

The Model Mixer UI now states this execution-recipe behavior. Recommendation routing has not yet been changed by this step.
