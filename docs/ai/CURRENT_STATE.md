# CoOperative AI Current State

Last updated: 2026-09-30

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
