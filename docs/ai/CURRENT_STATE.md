# CoOperative AI Current State

Last updated: 2026-10-03

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

## Access boundary

Authenticated accounts are not automatically granted the main CoOperative business/operator chat.

Current rule:
- the hosted main CoOperative chat and business/operator tools are temporarily owner-only and require membership in `unison_platform_owners`;
- the current database has exactly one platform owner, so this gates the main experience to the owner's login only;
- owning a CoOperative organization does not currently grant main-chat access;
- contributor/local-only accounts are redirected from `/chat`, `/local-ai`, `/agents`, `/services`, and `/intake` to `/personal-ai`;
- the main hosted chat APIs under `/api/local-ai/*` enforce the same boundary, except `/api/local-ai/nodes`, which remains available because Personal AI uses it to discover only the authenticated user's authorized Unison nodes;
- local-only users see CoOperativeLocalAI + Unison navigation on the home page instead of the main Chat/Agents entry points;
- Personal AI remains scoped to the authenticated user's authorized PC/node access and is separate from the main business/operator chat.
- Future main-chat multi-user access should use an explicit per-user entitlement plus that user's own AI balance/spend ceiling. Do not re-open access merely because a user owns an organization; the entitlement and budget boundary should be implemented together.

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

The preference is stored in `personal_ai_settings`.

Recommendation routing now consumes it with request-level scope:
- explicit SFW requests and ordinary non-adult media requests are **not** filtered or preferred by adult capability, regardless of which NSFW-capable mode is saved;
- an explicit adult-output request is blocked at recommendation time while NSFW is off;
- with **Adult content allowed**, routes known to disallow/block adult output are excluded, while verified and still-unknown routes can remain candidates;
- with **Prefer adult-capable models**, the same eligible pool is used and verified adult-capable routes receive a modest quality-ranking preference when otherwise competitive;
- with **Require adult-capable models**, only routes with current verified adult capability remain;
- provider/model policy marked `disallowed` always wins over older observed success;
- the latest controlled blocked test prevents that exact route from being treated as adult-capable.

Recommendation routing and provider/local execution now use the same content boundary. Adult-output submissions are re-checked against the current saved preference and exact-route capability evidence immediately before execution; SFW requests remain unaffected by adult-capability settings.

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

The authenticated read-only endpoint `/api/inference/media/capabilities` exposes the current preference, model capability metadata, and the latest observed tests for the active owner/profile. It reports content-aware recommendation routing as active.

### Per-prompt spend ceiling

The Model Mixer now treats its request cap explicitly as **max spend per prompt**.

Behavior:
- the value is persisted per authenticated profile in `personal_ai_settings.max_spend_per_prompt_usd`;
- the Model Mixer exposes both an exact numeric value and a $0–$5 slider, while still allowing typed values up to $100;
- changing the slider/numeric cap saves the profile ceiling;
- chat can change or read the value deterministically without calling an AI model, e.g. `set max spend per prompt to $0.25` or `what is my max spend per prompt?`;
- a conversational update is returned to the client as a Model Mixer update so the visible slider/value changes immediately;
- the cap remains a hard ceiling, not a spending target.

This is the foundation for future multi-user main-chat access: each entitled login can carry its own balance plus its own per-prompt spend ceiling.

### Strict-free Hermes text reasoning fallback

Normal text chat now follows the intended cost/capability ladder after all deterministic/code handlers have had the first chance to answer:

`code/deterministic -> owned/local text -> strict-free Hermes/OpenRouter text -> funded premium text (only when existing balance/cap rules allow)`.

Behavior:
- deterministic/business/media-routing handlers still run before any model job is queued;
- owned/local text gets an 8-second claim window;
- required-node routing remains a hard boundary and never spills to cloud;
- if a normal text job is still unclaimed after 8 seconds and OpenRouter is connected, CoOperative atomically claims that same job for `cooperative-hermes-free-text`;
- Hermes runs in Vercel Sandbox with `openrouter/free`;
- the text fallback is reasoning-only: the Hermes CLI platform is explicitly configured with an empty toolset list, so it cannot browse, run terminal/file tools, or perform external side effects;
- the fallback receives the original code-authored system/business instructions plus recent conversation history from the queued inference job;
- code-provided system instructions remain authoritative over user conversation turns;
- successful free reasoning completes the original job/conversation, with no profile-balance reservation or charge;
- if free reasoning fails and the source text job is eligible for funded fallback, the existing paid-fallback path may run next under the saved per-prompt spend cap and available profile balance;
- if paid fallback is not eligible, the failed job continues through the normal failure/recovery path;
- Stop/cancel terminates the free Hermes text sandbox.

The chat UI reports `Checking local reasoning capacity…` and then `Using free cloud reasoning…` when that lane takes over.

### Strict-free Hermes vision fallback

Image-understanding chat now has a zero-model-cost cloud fallback behind the owned/local vision queue.

Routing:
- local/owned vision gets the first 8 seconds to claim a vision job;
- if the job is still unclaimed, CoOperative atomically claims that same job for `cooperative-hermes-free-vision`;
- Hermes runs in Vercel Sandbox using OpenRouter `openrouter/free` for orchestration;
- Hermes `vision_analyze` is pinned to the explicitly-free `qwen/qwen3.8-27b:free` auxiliary model by default;
- all attached images remain private and are copied into the sandbox from authenticated Supabase storage;
- if free cloud vision succeeds, the result is written back to the original text inference job/conversation;
- if it fails, the original job returns to the owned/local queue and `fallback_attempted_at` prevents a cloud retry loop;
- paid vision fallback remains disabled regardless of the Model Mixer spend ceiling;
- required-node routing never spills to cloud;
- cancellation stops the Hermes vision sandbox.

The UI distinguishes `Checking local vision capacity…` from `Using free cloud vision…`, so zero-cost cloud fallback is visible rather than being presented as local execution.

The free cloud path is multimodal reasoning, not a vision-only captioner. Hermes uses the free main model for text reasoning/synthesis after `vision_analyze` inspects the image. Before the sandbox starts, it reloads the original persisted inference job and carries forward the code-authored system/business instructions plus recent conversation context. Those code-provided system instructions are explicitly marked authoritative over user turns, so cloud fallback follows the same deterministic operating policy instead of answering from only the latest image prompt.

The fallback path has a successful TypeScript/Vercel preview build. A preview-only live probe could not reach production-only Supabase credentials, so end-to-end provider execution must be verified from the authenticated production chat after deployment; no paid route is permitted during that verification.

### Chat media handling and CoOperative Cloud

Generated media in main CoOperative chat now has a dedicated handling flow.

Viewer behavior:
- tapping a generated image or video opens a true viewport-filling media viewer;
- the media itself fills the screen with `object-fit: contain`;
- a tap toggles the control overlay so the media can be viewed with no UI over it;
- overlay actions are Save to Photos, Share, Save to CoOp Cloud, and Close;
- Share prepares an authenticated temporary file and uses the device Web Share sheet when supported;
- mobile web apps cannot silently write directly into the iOS/Android photo library, so Save to Photos prepares the file and uses the native save/share surface where the phone exposes Save Image/Save Video; non-share-capable browsers fall back to a normal file download.

Persistent cloud behavior:
- `cooperative_media_library` stores private per-owner media metadata;
- binary media is copied from the provider result into the private `cooperative-media-library` Supabase Storage bucket, so future recall does not depend on the provider URL remaining alive;
- the first save is idempotent per source media job;
- the chat `+ Image` action now offers Photo Library / Files or CoOp Cloud;
- CoOp Cloud opens a saved-media picker in any later conversation;
- saved images can be copied back into a fresh chat attachment and used as reference/vision input;
- saved videos remain browsable in CoOp Cloud but are not yet supported as chat attachments.

Security and durability:
- generated media export/share is proxied through an authenticated endpoint that verifies the source job belongs to the current owner;
- cloud library objects are private and streamed through an authenticated endpoint;
- completed assistant media messages are linked to their source job IDs for reliable later export/save;
- already-existing media messages can still be matched to their owned completed job by result URL.

### Automatic evidence-ranked media execution

Clear media requests now execute automatically when at least one exact, execution-ready route fits the current per-prompt spend ceiling.

Behavior:
- explicit High / Medium / Low recommendation selections still execute the requested tier;
- requests that explicitly ask to compare/show/review options still stop at the recommendation cards;
- otherwise CoOperative filters the ranked options to routes whose safe cap fits the current prompt ceiling and whose execution path is enabled;
- among those routes it chooses the highest evidence-driven routing quality score, then stronger benchmark coverage, then lower cost;
- if no route fits, generation does not start and the ranked choices remain visible;
- over-cap cards now visibly show the current prompt cap and the additional amount required;
- selecting an over-cap card remains an explicit user action that can raise the request cap for that chosen execution.

This closes the gap exposed by the first post-benchmark test: with a $0.05 prompt cap, Nano Banana Pro may remain the highest-quality visible route at about $0.15, while Z-Image Turbo at about $0.005 should be selected and started automatically when it is the best evidence-ranked route that actually fits the cap.

### Benchmark review UI

The completed Z-Image Turbo vs Nano Banana Pro benchmark is now reviewable inside the owner Model Mixer.

The review flow:
- loads the six completed `media_quality_v1` source jobs directly from `media_generation_jobs`;
- presents each matched prompt as a side-by-side Z-Image/Nano Banana comparison;
- exposes the original prompt and scoring criteria beside the images;
- allows owner scoring on a 0–100 scale;
- composition and realism cases score visual quality + prompt adherence;
- the hands case additionally scores anatomy/hands;
- each save appends source-job-linked `manual_review` evidence to `media_model_benchmarks`;
- route scorecards average the latest review for each source job/dimension so the three test images contribute to aggregate visual-quality and prompt-adherence scores while the hands test contributes anatomy evidence;
- saved evidence is consumed immediately by evidence-driven routing.

Unknown/unreviewed dimensions remain unknown. Reference fidelity, edit strength, and speed are not inferred from this review.

### First quality benchmark executed

The first controlled SFW quality comparison between Nous / `fal-ai/z-image/turbo` and Nous / `fal-ai/nano-banana-pro` completed successfully.

Run facts:
- 6/6 exact-route generations completed;
- 3 identical prompts were sent to each route;
- cases: composition/prompt adherence, hands/anatomy, premium photorealistic quality;
- benchmark mode passed the user-request benchmark prompt verbatim to the configured image tool;
- no retry, fallback, or model/provider substitution was allowed;
- live estimated provider cost totaled $0.465;
- aggregate hard call ceilings totaled $0.48, matching the approved benchmark ceiling;
- all result URLs and source jobs are persisted in `media_generation_jobs` with `pricing_dimensions.benchmarkSuite = "media_quality_v1"`.

Scoring status:
- output-quality, prompt-adherence, and anatomy scores are intentionally still unfilled until the generated images are visually reviewed;
- no score should be inferred from price/model tier;
- this run was polled in a batch after the generators had already finished, so the persisted `completed_at` timestamps are reconciliation times rather than exact generation-finish times. Do not use them as precise speed scores;
- future benchmark execution should continuously capture terminal time or provider-reported generation latency before writing a measured speed score.

The temporary internal runner used for this approved one-time execution has been removed. Exact-prompt benchmark mode remains available in the Hermes media worker for future benchmark infrastructure.

### Evidence-driven media routing

Media recommendation routing now consumes exact-route benchmark evidence when it exists instead of treating model tier/price as the only quality signal.

Current behavior:
- benchmark observations are stored in `media_model_benchmarks` by exact provider/model/endpoint and dimension;
- route scorecards expose visual quality, prompt adherence, anatomy, reference fidelity, edit strength, speed, benchmark coverage, and the selection basis;
- measured benchmark evidence replaces the corresponding portion of the catalog/model-tier heuristic as coverage grows;
- missing dimensions remain visibly unbenchmarked rather than being invented;
- SFW routing ignores adult-capability status;
- non-explicit adult Allowed keeps verified and unknown eligible while excluding blocked routes;
- Prefer gives verified exact routes a modest ranking advantage when otherwise competitive;
- Require keeps only verified exact routes;
- the two existing non-explicit adult tests for Z-Image Turbo and Nano Banana Pro are now directly usable by that routing logic, but they do not count as quality benchmarks.

Canonical benchmark/scoring plan: `docs/ai/MEDIA_BENCHMARK_FRAMEWORK.md`.

### Capability test polling recovery

The Capability Lab client now keeps polling an active one-shot test until it reaches a terminal state. The previous implementation used a one-shot timeout whose effect depended on the job status; when a poll returned the same `running` value, React had no state change to trigger another timeout, so a successful provider result could remain stranded as `running` in the database until a later catalog refresh.

The polling loop now:
- checks immediately when an active test is known;
- continues every 3.5 seconds while the job remains queued/running;
- prevents overlapping checks in the same tab;
- leaves transient polling errors non-terminal so a later check can recover;
- still relies on the existing server reconciliation path after the hard execution deadline.

The previously stranded Nano Banana Pro test (`fal-ai/nano-banana-pro`) was recovered from its original completed Vercel sandbox without starting another model call. The sandbox output contained a successful media result, so the existing job is now persisted as `completed` and the exact Nous route is recorded as `supported` for `adult_non_explicit_boundary` only. This does not establish sexually explicit capability.

### Capability evidence lab

Model Mixer now contains a bounded capability lab for adult-output routing evidence.

Policy refresh:
- refreshes current Nous/fal, OpenRouter, and owned/local policy-source metadata without spending generation credits;
- expands `media_model_capabilities` to the current executable media catalog;
- keeps broad provider policy separate from exact model capability;
- records a source and check timestamp without converting a general terms page into a fake `allowed` capability.

Controlled tests:
- expose current hosted text-to-image routes with live pricing;
- require NSFW enabled plus the saved 18+ acknowledgment;
- require an explicit **Prepare one test** step followed by **Run one test**;
- enforce the existing Model Mixer cap and never increase it automatically;
- permit only one active test per profile;
- make exactly one model call, with no retry, provider substitution, fallback, or Recovery Agent launch;
- persist the result in `media_model_capability_tests` against the exact route and source media job.

The first standardized test scope is `adult_non_explicit_boundary`: a fictional adult fine-art figure study that may contain non-explicit nudity but no sexual activity, graphic sexual detail, real-person likeness, or minors. Success verifies only that non-explicit scope. It does **not** certify sexually explicit output.

Adult intent is now classified as `sfw`, `adult_non_explicit`, or `adult_explicit`. Sexually explicit requests require evidence that actually covers explicit output; a successful non-explicit test cannot satisfy that requirement. Current provider restrictions remain authoritative and can block a route regardless of an older test.


### Capability evidence lab validation status (2026-10-03)

The first production capability-lab validation is now complete enough to guide continued testing.

Observed results:
- `nous · fal-ai/z-image/turbo` completed the standardized `adult_non_explicit_boundary` test and returned usable media;
- that exact route is persisted as **supported** for the non-explicit adult/nudity boundary only;
- this result does **not** verify sexually explicit output.

The first run also exposed a completion-tracking issue: the provider job eventually completed, but the browser-driven polling flow initially left the capability-test record looking stuck. PR #152 hardened this behavior so expired queued/running capability tests are reconciled before catalog reads or new tests, and stale jobs no longer permanently block the next test.

Capability-test spend semantics are now stricter:
- the broader Model Mixer cap is only an eligibility ceiling;
- the actual capability-test job is submitted with the exact prepared route safe cap;
- no retry or fallback is allowed;
- Economy can legitimately make a test button unavailable when its session ceiling is below the selected route's live safe cap;
- changing to a higher preset is a manual user decision and does not automatically raise a test cap;
- when a prepared route's safe cap is above the current session cap, the Capability Lab now offers a manual **Set test cap to $X** action that changes only the session cap to that exact safe cap; it never auto-runs the test or raises the cap without a click;
- when an active capability test is recovered after reopening the Model Mixer, the route selector follows that active exact route so the visible route and running-status message stay aligned.

Current second validation:
- `nous · fal-ai/nano-banana-pro` is running the same `adult_non_explicit_boundary` test;
- current live prepared/approved cap: **$0.15**;
- it was unavailable under Economy because the Economy ceiling was below that route's current safe cap;
- the user manually changed to Balanced before starting the test;
- this price is live/dynamic evidence, not a permanent hard-coded model price.

Next step after this test completes:
- inspect and persist the exact-route outcome;
- compare its behavior with the already-supported Z-Image Turbo result;
- continue one route at a time, preserving the same no-retry/no-fallback test discipline;
- do not infer sexually explicit capability from a successful non-explicit test.

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

The Model Mixer UI states this execution-recipe behavior, and recommendation ranking now uses it.

High/Medium/Low are selected from complete candidate configurations:
- **High** prioritizes the strongest configuration-quality score, including model quality plus output configuration such as resolution where applicable;
- **Medium** balances configuration quality against the cost midpoint rather than simply choosing the middle-priced model;
- **Low** remains the cheapest exact-request candidate, with configuration quality used as a tie-breaker.

Recommendation cards now expose the workflow, quality goal, output configuration, content-output constraint, and adult-capability evidence when relevant.


### Content-aware execution gate

The selected recommendation's content-output constraint now reaches actual execution. Immediately before owned/local, Nous, or OpenRouter submission, CoOperative re-checks the current saved preference and exact provider/model/endpoint capability evidence for adult-output requests. The same gate also applies to manual retries and automatic local/OpenRouter fallback routes, preventing stale recommendation state from bypassing a later preference or policy change. SFW requests do not become restricted merely because an adult-capable preference is saved.

If current adult-policy evidence cannot be checked at execution time, adult output fails closed rather than relying on stale metadata. `require_adult_capable` requires verified capability; `adult_allowed` and `prefer_adult_capable` may still execute an unknown route only when it is not currently known to be blocked.
