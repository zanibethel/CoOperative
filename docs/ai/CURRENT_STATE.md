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

### Next media implementation layer

Verify the connected Nous managed-gateway allowlist and attachment handoff for the discovered premium reference routes without broadening any other media behavior. Only after that passes should premium reference cards become executable.
