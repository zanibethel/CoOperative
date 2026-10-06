# CoOperative Media Routing Policy

Status: Canonical owner-approved product policy  
Last updated: 2026-10-05

This document is the durable source of truth for CoOperative media-request interpretation, recommendation, budget, provider-routing, reference-image, retry, and UI behavior.

New implementation work must preserve these rules unless a newer explicit owner decision supersedes them.

## 1. Core product behavior

Once CoOperative clearly understands a media request, it should stop before generation and present three actionable recommendations instead of silently choosing a paid route.

The three recommendations are:

1. **High** — the best verified quality/value route that fulfills the exact request.
2. **Medium** — a meaningful quality/cost compromise between High and Low.
3. **Low** — the cheapest verified route that still fulfills the requested task correctly.

The user chooses the route. A provider/model being available never counts as permission to spend.

## 2. Exact-request preservation

Recommendation generation should preserve the user's requested constraints unless the user explicitly asks CoOperative to optimize or reduce them.

For video this includes, when specified:
- duration;
- resolution;
- aspect ratio;
- generated audio on/off;
- other explicit media requirements.

For images this includes:
- requested aspect ratio;
- reference-image usage;
- identity/style/reference requirements;
- explicit quality requirements.

Do not silently shorten duration, lower resolution, remove audio, drop a reference image, or otherwise change the ask merely to fit the current budget.

If the exact request exceeds the current cap, still show the exact-request recommendations and quote the required cap increase.

## 3. Recommendation tier intent

### High

High answers:

> What is the strongest verified way to do exactly what I asked, with good value among premium-capable models?

High should use the best verified route available for the requested capability. For reference-image work, this should normally prefer a qualified premium Hermes/Nous route when one truly supports the reference requirement.

High is not simply "most expensive." Quality/capability/value should drive selection.

### Medium

Medium answers:

> What is a strong compromise between quality and cost?

Prefer a distinct model/route between High and Low. For reference-image work this may be:
- a cheaper premium Hermes/Nous route;
- another qualified hosted reference-capable model;
- or a strong owned/local quality route when no credible premium middle option exists.

### Low

Low answers:

> What is the cheapest real way to fulfill the request?

Low must still satisfy the requested capability. A cheap route that ignores the attachment, drops required audio, changes the task, or cannot perform the requested transformation is not a valid Low option.

Owned/local compute will often be Low when capable.

## 4. Recommendation UI

Recommendations should render as full-width expandable cards in chat.

Display order:
1. High
2. Medium
3. Low

Collapsed card:
- tier label;
- short route/model label when useful;
- estimated cost.

Expanded card:
- provider;
- model;
- route type;
- exact media request summary;
- whether/how the reference image is used;
- quality/reference behavior;
- estimated provider cost;
- safe request cap;
- cap increase required;
- explicit **Use this option** action.

Selecting a card may prepare/update the Model Mixer media level and request cap, but recommendation display itself must not start paid generation.

## 5. General execution hierarchy

Use deterministic code first for parsing, routing, validation, capability checks, budgeting, state transitions, and known workflow logic.

When AI/media generation is actually needed, preserve this overall preference hierarchy:

1. deterministic/code handling;
2. owned/local AI when capable and economically appropriate;
3. connected Nous/Hermes entitlement and qualified models;
4. free/eligible hosted routes;
5. OpenRouter paid capacity as backup;
6. higher-cost paid routes only when justified and within the approved budget.

This hierarchy is a routing preference, not a requirement that Local always be High or that every subtask use the selected premium model.

The Model Mixer is a request-level quality/cost ceiling. Cheaper/free models may perform subtasks that do not materially benefit from the premium route.

## 6. Nous/Hermes and OpenRouter policy

When capability exists through a connected Nous/Hermes account, prefer that before OpenRouter paid fallback.

OpenRouter is paid backup capacity, not the default first paid provider.

For all paid media routes:
- inspect live/current capability and pricing when practical;
- do not assume an unverified paid route is affordable;
- do not make a provider call merely because a key exists;
- enforce the request cap before the expensive call;
- make the smallest useful number of expensive generation calls.

Use low-cost/free planning, prompt refinement, deterministic logic, and local reasoning before the expensive media-generation call.

## 7. Budget policy

Default testing/request ceiling: **$0.05** unless explicitly changed by the user or another approved profile policy.

The ceiling means:
- spend up to this amount if justified;
- do not try to spend the full amount;
- do not exceed it automatically.

When the exact request does not fit:
- show the High / Medium / Low exact-request recommendations;
- show the estimated total cost;
- show the required cap;
- show the incremental increase above the current cap.

When useful, separately offer user-controlled task changes such as:
- lower resolution;
- shorter duration;
- no generated audio;
- lower quality;
- local generation.

Those changes must be explicit user choices, not silent substitutions.

## 8. Cost accounting

Keep these concepts separate:

- provider cost;
- infrastructure/tool cost;
- user charge;
- CoOperative margin.

Do not treat unknown infrastructure cost as zero.

Do not infer actual cost from an estimate after execution. Record measured/settled values separately when available.

A connected business-owned/provider account and a CoOperative-funded paid route are distinct funding cases.

## 9. New task vs follow-up boundary

A clear new media request starts a new media task.

An unresolved recommendation from an earlier image/video task must not contaminate a later request.

Examples that should start a new task:
- "Create an image..."
- "Generate a new image..."
- "Provide an image..."
- "I'd like an image..."
- "I want a video..."

A new image request after unresolved video recommendations abandons that unresolved video path unless the user explicitly refers back to it.

Only inherit prior media controls when the user's message is clearly a follow-up, such as:
- "as long as possible within budget";
- "remove the audio";
- "make it 720p";
- "use the High option";
- "retry that image";
- "use the same reference image".

Do not combine independent media tasks merely because they occur in the same conversation.

## 10. Attachment reuse boundary

Attachments belong to the current request unless the user explicitly asks to reuse a previous one.

Do not automatically attach the most recent image to later unrelated messages.

A previous attachment may be reused when the user explicitly says things like:
- "use this image";
- "edit that picture";
- "use the previous image";
- "same reference";
- "base it on the last photo".

Persist enough request context that retry/selection can recover the correct attachment for the newest unresolved task.

## 11. Reference-image request definition

Treat a request as reference-image generation when:
- the user attaches an image and asks to create/generate/make/provide/render a new image based on it; or
- the user explicitly asks to use/reference an existing attached image.

Examples:
- "Create an image referencing this one."
- "Make a better version of this."
- "Use this image as a reference and create a new portrait."
- "Provide an image based on this one."

This is an image-generation task, not ordinary vision analysis unless the user asks to analyze/describe rather than create.

## 12. Reference-image capability truthfulness

Reference-image recommendation cards may include only routes that actually consume the reference image in the requested way.

Eligible capability classes include verified:
- image-to-image;
- identity-preserving generation;
- IP-adapter/reference guidance;
- other explicit provider/model reference-image features.

Do not:
- show text-to-image models as reference-capable when they would ignore the attachment;
- label an option "premium reference" without verified reference support;
- imply identity preservation if the route only performs loose style/reference guidance.

Each card should state what the route actually does, for example:
- Uses attached reference image directly.
- Uses identity/reference guidance.
- Uses local image-to-image mode.
- Loose visual reference only.
- No verified premium reference route available.

## 13. Premium Hermes/Nous reference-image recommendations

Reference-image recommendations must not be limited to local models when a higher-quality verified Hermes/Nous route exists.

Candidate premium routes must satisfy all of these:
- available/eligible now or clearly connectable through the user's authorized Nous/Hermes context;
- current pricing can be established safely;
- model/provider supports the actual reference-image operation requested;
- CoOperative can pass the attachment through correctly;
- route fits the user's selected/approved cap before execution.

Preferred tier behavior:

### High
Use the best verified premium reference-capable Hermes/Nous route when available and justified.

### Medium
Use a lower-cost premium reference-capable route when available. Otherwise use the strongest appropriate local quality/reference route.

### Low
Use the cheapest verified reference-capable route, frequently an owned/local fast/reference route.

If no premium reference route can be verified, say so and build High/Medium/Low from valid local/other routes instead.

## 14. Local reference-image routes

Owned/local reference-image capability is a first-class route when the node advertises and is authorized for features such as:
- image_generation;
- image_to_image;
- ip_adapter_identity;
- single_reference_identity;
- quality/fast profiles.

Current local recommendation intent:
- High local reference: strongest quality/identity-preserving local mode;
- Medium local reference: quality/reference-preserving mode;
- Low local reference: fastest/lowest-cost valid reference mode.

A temporarily offline/idle node may remain recommendable when it is registered and capable, provided execution clearly queues until the worker becomes available and no false completion claim is made.

## 15. Retry semantics

Retry means retry the **newest unfulfilled relevant media request**, not blindly retry the newest historical media job.

If the user has:
1. made a new reference-image request;
2. received recommendations/preflight;
3. not yet produced a result;
4. then says "retry image request";

CoOperative must target that unresolved request even if an older completed image job exists in the same conversation.

Examples:
- "retry image request";
- "retry with .05 budget";
- "highest quality";
- "use high";
- "use medium";
- "use low".

Preserve the correct attachment and request constraints.

Do not duplicate an active paid generation.

If a paid attempt may already have incurred cost, do not automatically repeat it unless the applicable budget/approval policy permits the second charge.

## 15A. Workflow one-shot video execution

Direct OpenRouter text-to-video plumbing is implemented, but **workflow video execution is currently disabled**.

The prepared adapter:
- pins one OpenRouter model slug and one exact persisted recipe;
- revalidates current capability and price before any spend;
- reserves shared workflow budget and, when applicable, CoOperative-funded AI balance;
- submits at most one native OpenRouter video generation request;
- never automatically resubmits generation or substitutes another model after failure;
- persists the provider job ID so polling can resume without creating another generation;
- stores completed clips in the private CoOperative media library with a 100 MB limit.

Current blocker:
- OpenRouter's documented `provider` field for `POST /api/v1/videos` is provider-specific passthrough configuration;
- current public video documentation does not document the chat/image-style `allow_fallbacks` provider-routing control for this endpoint;
- therefore CoOperative cannot truthfully guarantee that OpenRouter will not change its underlying serving provider while keeping the same requested video model.

Owner policy still requires no automatic provider/model fallback for this rollout. Until OpenRouter exposes documented provider pinning for video, or the owner explicitly accepts OpenRouter-managed serving-provider routing, the workflow video execution server gate and UI approval action must remain off.

This does not enable Nous/PixVerse workflow video execution or reference-image/image-to-video workflow execution.

## 16. Execution truthfulness

A text/planning model must never claim:
- generation started;
- API call started;
- purchase occurred;
- deployment occurred;
- message was sent;
- other side effect completed;

unless current runtime/tool state confirms it.

Planning language must remain planning language.

## 17. Clarification policy

Ask only for information required to execute safely.

Do not ask for a value the user already supplied.

Use sensible defaults when product policy explicitly provides one and the missing choice does not materially change the user's intent.

Current video default:
- if format/aspect ratio is omitted, default to landscape 16:9 rather than stopping solely for that clarification.

## 18. Developer implementation checklist

### Request parsing
- [ ] Recognize common creation verbs and natural forms such as "provide", "I'd like", and "I want".
- [ ] Distinguish create/generate from analyze/describe.
- [ ] Parse hyphenated controls such as "10-second".
- [ ] Preserve explicit duration, resolution, aspect ratio, and audio.
- [ ] Treat clear new media intent as a new task.
- [ ] Reuse prior task context only for clear follow-ups.

### Task state
- [ ] Persist enough request context to recover the newest unresolved media task.
- [ ] Persist attachment IDs with the request/recommendation state.
- [ ] Do not infer active request solely from the newest media job.
- [ ] Prevent duplicate active generation.

### Capability discovery
- [ ] Check verified local node capabilities.
- [ ] Discover live Nous/Hermes reference-capable routes.
- [ ] Discover eligible hosted/OpenRouter routes.
- [ ] Exclude models that cannot meet exact requested controls.
- [ ] For reference-image tasks, exclude routes that cannot consume the reference.

### Pricing
- [ ] Retrieve current/live price where practical.
- [ ] Estimate request-specific cost using requested controls.
- [ ] Never substitute stale hard-coded pricing as spending authority.
- [ ] Calculate safe cap and incremental cap increase.

### Recommendations
- [ ] Build three meaningful tiers: High, Medium, Low.
- [ ] Avoid duplicate choices unless only one valid route exists.
- [ ] Preserve exact request in all three unless explicitly marked as an alternative.
- [ ] Prefer qualified Nous/Hermes premium routes before OpenRouter paid fallback.
- [ ] Include local routes where capable.
- [ ] Explain reference behavior honestly.

### UI
- [ ] Render full-width expandable recommendation cards.
- [ ] Keep collapsed cards concise.
- [ ] Show provider/model/cost/cap/reference behavior on expand.
- [ ] Provide explicit Use action.
- [ ] Do not start paid generation when merely displaying recommendations.

### Execution
- [ ] Preserve chosen route/model and current attachment.
- [ ] Enforce cap immediately before provider call.
- [ ] Reserve/settle platform-funded balance where applicable.
- [ ] Queue local work safely when worker is unavailable.
- [ ] Record provider/model/route/cost metadata.
- [ ] Never claim execution without runtime confirmation.

### Failure/retry
- [ ] Retry newest unresolved request, not arbitrary newest historical job.
- [ ] Preserve attachment and request controls.
- [ ] Do not automatically duplicate potentially charged paid attempts.
- [ ] Fall back according to routing hierarchy and budget policy.
- [ ] Surface concise actionable failure state.

## 19. Acceptance tests

The implementation is not complete until these behaviors pass.

### A. Clear exact video request
Input:
> Create a 10-second 1080p video with audio of a futuristic city at night.

Expected:
- exact controls parsed;
- no unnecessary duration/format clarification;
- High/Medium/Low recommendations displayed;
- exact request preserved in all exact-match cards;
- no generation before selection.

### B. New task after unresolved video
Context:
- unresolved video recommendations are visible.

Input:
> Create a portrait image of a golden retriever.

Expected:
- new image task starts;
- no video duration/resolution/audio inherited;
- image recommendations only.

### C. Attached reference image
Input:
- attachment;
- "Create a high-quality image referencing this one."

Expected:
- reference-image generation recognized;
- only verified reference-capable routes considered;
- Hermes/Nous premium options included when genuinely available;
- local reference routes included when capable;
- High/Medium/Low cards explain reference behavior.

### D. Reference truthfulness
If a premium model is text-to-image only:

Expected:
- it is excluded from reference-image cards;
- it is never presented as a premium reference route.

### E. Budget
Current cap: $0.05.

Expected:
- recommendation cards may show options above $0.05;
- each shows exact estimate and required increase;
- no automatic cap increase;
- no paid call until user selection/approval satisfies the cap.

### F. Retry unresolved request
Context:
- older completed image job exists;
- newer reference-image request has recommendations but no result.

Input:
> Retry image request with .05 budget highest quality.

Expected:
- retry targets newer unresolved request;
- older completed result does not block it;
- current reference attachment is preserved.

### G. Attachment isolation
Context:
- one request used an attachment.

Input:
> Generate a completely new landscape image.

Expected:
- previous attachment is not reused unless explicitly requested.

### H. Explicit attachment reuse
Input:
> Use the previous image as reference and make it more cinematic.

Expected:
- previous attachment is intentionally recovered;
- route remains reference-capable.

### I. Execution truthfulness
If only planning/recommendation occurred:

Expected:
- assistant never says "generation initiated" or equivalent;
- runtime status is the sole authority for execution claims.

## 20. Non-goals for the current reference-image upgrade

The reference-image recommendation upgrade does not require:
- full reference-image video generation;
- fake premium options;
- a broader redesign of the chat shell;
- abandoning local-first economics;
- automatic cap increases;
- automatic paid generation.

The immediate goal is:
- correct task boundaries;
- truthful capability matching;
- premium Hermes/Nous reference-image options when valid;
- local fallback;
- three-tier recommendations;
- explicit budget control;
- correct retry behavior.


## 21. Adult-capable media preference and capability testing

CoOperative may maintain a profile-level compatibility preference for adult-capable media models.

The Model Mixer presents this as an **NSFW output** checkbox, not as an SFW-model filter.

Default state:
- **NSFW unchecked** maps to stored mode `sfw_only`.
- This means generated output must remain SFW.
- It does **not** exclude a model merely because that model is also capable of adult content.
- Adult-capable models remain fully eligible for SFW requests when they are otherwise the best execution route.

When NSFW is checked:
- the UI expands the adult-output options;
- **Adult content allowed** is selected by default;
- the user may manually select **Prefer adult-capable models** or **Require adult-capable models**;
- an explicit 18+ acknowledgment is required before saving.

Expanded preference modes:
- **Adult content allowed** — adult output is permitted when requested; otherwise choose the best execution recipe normally.
- **Prefer adult-capable models** — when routes are otherwise comparable, prefer a model verified to support the requested adult workflow without unnecessarily sacrificing output quality.
- **Require adult-capable models** — for applicable adult media requests, exclude routes not verified to support the requested adult workflow.

SFW/NSFW is therefore primarily an **output constraint**. Adult-content support is a separate **model capability** used only when relevant to fulfilling the requested output.

The preference does not override:
- provider/model terms;
- model-specific content restrictions;
- platform safety boundaries;
- legal restrictions;
- request-level budget or capability requirements.

Hard disallowed content remains disallowed regardless of preference, including sexual content involving minors and non-consensual sexual material.

### Capability truthfulness

Do not assume a model is adult-capable because it is uncensored, locally hosted, expensive, or historically permissive.

Track adult capability separately from general image quality and reference-image capability.

Model capability metadata should distinguish:
- published/current provider policy;
- current model/endpoint identity;
- observed behavior from controlled tests;
- whether a result was supported, blocked, partial, or inconclusive;
- date/source of the observation.

An observed successful test is evidence of behavior at that time, not a guarantee that a provider will continue to allow the same content later.

### Controlled model tests

When testing models for capability understanding:
- use explicit user approval and the normal spend cap;
- test one model/endpoint at a time when practical;
- record the exact provider/model/endpoint;
- classify the test type;
- record outcome as supported, blocked, partial, or inconclusive;
- link the source media job when applicable;
- record concise notes about fidelity, policy response, or failure mode;
- do not silently turn capability testing into broad routing changes.

Useful test dimensions include:
- adult-content support;
- reference fidelity;
- identity preservation;
- edit strength;
- provider/policy behavior.

Capability test results should inform future recommendation quality, but routing must continue to respect current provider rules and safety boundaries.


## 22. Model Mixer execution-recipe principle

The Model Mixer is not merely a model picker.

For each task or subtask, it should determine the best **execution recipe** within the user's selected quality/cost ceiling and explicit constraints.

A media execution recipe may include:
- provider and model;
- generation mode such as text-to-image, reference edit, image-to-video, or other supported workflow;
- requested output type;
- resolution and aspect ratio;
- duration and audio for video;
- quality/detail settings;
- reference-image behavior, reference strength, and fidelity goals where supported;
- number of outputs when relevant;
- estimated provider/infrastructure/user cost;
- expected completion time;
- content-output constraints such as SFW or permitted adult output;
- other capability-specific controls exposed by the chosen route.

The agent slider represents a **quality/cost ceiling**, not a command to use a particular model or to spend the full amount.

Recommendation quality should be judged on the resulting output recipe, not model price alone. A lower-cost model at stronger settings may be a better route than a premium model at constrained settings, and spending budget on resolution, duration, reference fidelity, or another output dimension may improve the requested result more than changing models.

High/Medium/Low recommendations should therefore compare complete executable configurations while preserving explicit request requirements unless an alternative is clearly labeled.


## 23. Content-aware recommendation routing

Adult-capability preference applies only when adult output is actually requested.

For SFW/non-adult media requests:
- do not filter out adult-capable models;
- do not prefer adult-capable models merely because NSFW is enabled;
- do not require adult capability merely because the profile stores Prefer/Require;
- choose the best execution recipe using the normal quality, capability, cost, time, and request constraints.

For an adult-output media request:
- `sfw_only`: stop at recommendation preflight and direct the user to enable NSFW; do not generate;
- `adult_allowed`: for **non-explicit** adult output, exclude currently blocked/disallowed routes while verified and still-unknown routes may remain visible;
- `prefer_adult_capable`: for **non-explicit** adult output, use the eligible pool and modestly prefer verified routes when otherwise competitive;
- `require_adult_capable`: only routes verified for the requested adult-output scope may be recommended;
- sexually explicit output requires exact-route evidence that actually covers sexually explicit output even when the saved preference is Allowed or Prefer.

Capability evidence is scope-aware:
1. current exact-route policy marked disallowed => blocked;
2. a controlled blocked test affects only the scope that test actually covered, with conservative blocking where the tested boundary is broader than the request;
3. a controlled supported test verifies only the scope it actually tested;
4. exact-route provider/model policy that explicitly allows the requested scope may verify it;
5. partial/inconclusive/no applicable evidence => unknown.

A successful `adult_non_explicit_boundary` test does not verify `adult_explicit` output.

Do not infer adult capability from price, local hosting, model branding, or historical reputation.

### Execution-recipe recommendation scoring

High/Medium/Low compare complete configurations, not model names alone.

- **High** prioritizes configuration quality. Model-quality signal remains important, while concrete output settings such as resolution can improve the score.
- **Medium** balances configuration quality and the cost midpoint.
- **Low** remains the cheapest exact-request configuration; quality breaks equal-cost ties.
- Explicit request controls remain hard constraints.
- Adult-capability preference may influence scoring only for an adult-output request.
- Recommendation metadata should expose workflow, quality intent, output configuration, content constraint, and relevant capability evidence.

Recommendation-time classification is intentionally conservative: explicit adult-output terms activate adult routing, while explicit SFW/no-nudity constraints keep the request on SFW routing. Execution must independently re-check the final request and current policy before provider submission.


## 24. Execution-time content enforcement

Recommendation-time eligibility is not sufficient authority to submit a media job.

Immediately before an adult-output execution, CoOperative must re-read:
- the profile's current NSFW/content preference and 18+ acknowledgment;
- the exact provider/model/endpoint adult-content policy metadata;
- the latest controlled adult-capability test for that exact route.

Execution uses the same scope-aware evidence rules as recommendation routing. A test result is applied only when its prompt classification covers the requested adult-output scope.

Execution rules:
- SFW/non-adult requests remain eligible regardless of adult-capability preference;
- `sfw_only` blocks an adult-output submission;
- for `adult_non_explicit`, `adult_allowed` and `prefer_adult_capable` may submit verified or still-unknown routes, but never a route currently known to block/disallow that scope;
- `require_adult_capable` submits only a route verified for the requested scope;
- `adult_explicit` submits only with exact-route evidence that actually covers explicit output;
- if current preference/capability evidence cannot be re-checked, adult output fails closed;
- changing the saved preference or capability evidence after recommendation generation takes effect before submission.

The gate applies to:
- a user-selected owned/local recommendation;
- a user-selected Nous/OpenRouter recommendation;
- retrying a prior media job;
- automatic owned/local fallback;
- automatic OpenRouter fallback.

Fallback economics never override the content gate. A cheaper or free route is not an acceptable fallback if its current content eligibility fails.


## 25. Capability evidence refresh and controlled testing

Capability learning is intentionally separated into **policy evidence** and **observed route behavior**.

### Policy refresh

Refreshing evidence may fetch current provider terms/policy pages and current executable media catalogs. This action must not submit a media generation or incur generation spend.

A general provider policy source may establish a provider-level restriction, but it must not be treated as proof that an individual model supports a particular requested output. Store the source/check timestamp and leave exact-route capability unknown unless the source is actually specific enough to establish it.

### Controlled capability test

A controlled capability test must:
- target one exact provider/model/endpoint at a time;
- show a current live estimate and safe cap before execution;
- require explicit user confirmation after route preparation;
- remain within the existing user-approved Model Mixer cap;
- submit the test job using the exact prepared route safe cap rather than the broader Model Mixer session ceiling;
- allow only one active capability test per profile;
- reconcile expired queued/running tests before allowing a new test so stale browser polling cannot permanently block the lab;
- make one generation call only;
- never retry, substitute another route, invoke fallback, or launch Recovery Agent;
- persist supported / blocked / partial / inconclusive with a source media job and prompt classification.

A preset may make the Run button unavailable when its session ceiling is below the selected route's current live safe cap. Raising the preset or session ceiling is always a manual user choice. The lab must not silently raise it.

The initial standardized prompt classification is `adult_non_explicit_boundary`. It uses a clearly adult fictional subject and may test non-explicit artistic nudity, but it excludes sexual activity, graphic sexual detail, real-person sexualization, and minors.

A successful test is evidence of behavior for that exact route and tested scope at that time. It is not permission to exceed current provider rules and is not a guarantee of future provider behavior.

## 26. Refusal smoke matrix

The owner model-registry console exposes a refusal/capability smoke matrix for currently executable hosted media routes.

The matrix separates three content scopes:

- `sfw_baseline` — a standardized clearly-SFW exact-route generation test.
- `adult_non_explicit_boundary` — a standardized clearly-adult fictional non-explicit boundary test. It may probe tasteful artistic nudity, but never sexual activity, graphic sexual detail, real-person sexualization, or minors.
- `adult_explicit` — **policy/evidence classification only**. CoOperative does not submit sexually explicit generation merely to probe whether a provider will refuse it.

Smoke-test invariants:

- one exact provider/model/endpoint/route-kind at a time;
- current executable registry route required;
- current request-specific provider price must be bounded;
- owner enters a per-test cap before submission;
- one provider generation call only;
- no retry;
- no model substitution;
- no provider fallback;
- no Recovery Agent;
- no silent cap increase;
- SFW tests do not require NSFW preference;
- non-explicit adult tests require the saved adult-output preference plus 18+ acknowledgment;
- known policy-disallowed scopes are never probed;
- OpenRouter smoke tests require the profile's own connected OpenRouter key and never silently consume CoOperative platform-paid OpenRouter credits;
- Nous tests use the profile's current Nous/Hermes authorization;
- route kind is persisted with controlled-test evidence so video observations are never mislabeled as image evidence.

The owner console defaults the smoke-test spend cap to zero. It shows the next untested route that fits the manually entered cap, but starting that route still requires an explicit owner click. Completing one test does not silently start another paid test.

The matrix stores results in the existing `media_model_capability_tests`, `ai_model_capability_evidence`, and `media_generation_jobs` evidence chain. SFW and non-explicit outcomes are tracked independently. A successful SFW test does not establish adult capability. A successful non-explicit test does not establish sexually explicit capability.

Provider policy refresh is generation-free. Current policy evidence may classify a scope as disallowed without spending inference credits. In particular, a provider-wide explicit-content prohibition applies to every exact route behind that provider boundary until fresher route-specific policy evidence supersedes it.

## 27. Durable Hermes sandbox artifacts

Hermes media workers may return either a remote HTTP(S) media URL or a sandbox-local result such as `MEDIA:/tmp/cooperative-hermes/cache/generated/.../file.png`.

A sandbox-local media path is not a provider failure. When Hermes exits successfully and the path is inside CoOperative's allowed generated-media directory, the poller must:

1. associate the persistent sandbox with its existing `media_generation_jobs` job id;
2. read the generated binary with the Vercel Sandbox file API before stopping the sandbox;
3. validate the file type against the media job kind and enforce the current 50 MB output ceiling;
4. upload the bytes into the private `cooperative-media-library` Storage bucket under the existing generated-job namespace;
5. merge `generatedStoragePath`, `generatedMimeType`, `generatedArtifactSource=hermes-sandbox`, and byte size into the existing `pricing_dimensions`;
6. return the authenticated `/api/local-ai/media-output?jobId=...` URL as the job result;
7. only then stop the persistent sandbox.

The local path is accepted only under `/tmp/cooperative-hermes/cache/generated/`; arbitrary sandbox paths are never copied into user-accessible storage.

Share, Save to Photos, export, and Save to CoOperative Cloud must prefer `generatedStoragePath` when it exists instead of attempting to fetch the relative authenticated result URL as though it were a public provider URL.

This handoff does not start a second inference call and does not change provider billing. Persistent sandboxes may be reopened to recover an already-generated artifact after a transport-path bug, and that recovery is recorded separately from model capability. A successful recovery may upgrade an SFW smoke observation from partial to supported without spending additional inference credits.

