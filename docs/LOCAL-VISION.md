# Local vision chat

CoOperative AI supports image understanding through an on-demand MLX vision model while preserving the existing persistent text queue.

## Default model

- Model: `mlx-community/Qwen2.5-VL-3B-Instruct-4bit`
- Runtime: `mlx-vlm` on Apple Silicon
- Environment override: `TEXT_VISION_MODEL_ID`
- Purpose: screenshots, photos, UI/error inspection, image description, and image-grounded follow-up questions

## Memory policy

The 16 GB M1 target should not keep Local Fast, Local Quality, and Local Vision loaded at the same time.

The worker keeps one inference model resident:
- text request -> load the requested text profile
- image request -> unload text and load Local Vision
- later text request -> unload Local Vision and load the requested text profile

This avoids silently overcommitting unified memory. The first request after a capability switch may be slower because the model must load.

## Attachment flow

1. The browser selects up to four images.
2. Large images are resized/compressed in the browser before upload.
3. The authenticated server stores the image in the private `local-ai-attachments` bucket.
4. The conversation stores only attachment IDs.
5. A vision job carries those IDs through the existing persistent inference queue.
6. The Mac worker authenticates to a worker-only attachment endpoint and downloads temporary copies.
7. `mlx-vlm` performs local image+text generation.
8. Temporary local files are deleted when generation finishes.
9. Saved conversations retain authenticated image previews for later review.

No image attachment is made public.

## Zero-cost cloud fallback

Main CoOperative chat keeps local vision first. When an image-understanding job remains unclaimed for 8 seconds and the profile has a connected OpenRouter credential, CoOperative may claim the same job for a strict-free Hermes cloud fallback.

The fallback contract:
- Hermes runs in an isolated Vercel Sandbox.
- The orchestration model is `openrouter/free`.
- `vision_analyze` is pinned to an explicitly free multimodal OpenRouter SKU (`qwen/qwen3.8-27b:free` by default, overridable with `HERMES_FREE_VISION_MODEL`).
- Hermes is configured to pre-analyze images through the auxiliary vision route.
- Up to four owned/private chat images are copied directly into the sandbox as local files; no public attachment URL is created.
- The fallback has no permission to use a paid model and does not reserve/charge the user's AI balance.
- If the free route is unavailable, rate-limited, or fails, the same job returns to the local vision queue and is not retried through a paid model.
- A user-selected required node remains a hard boundary and never spills to cloud.
- Stop/cancel also terminates the free vision sandbox.

This is a capacity fallback, not a replacement for owned/local compute.

## Follow-up context

If a user asks a follow-up in the same conversation without attaching another image, CoOperative reuses the most recent image attachment from that thread for the local vision request.

## Initial vision benchmark

Test at minimum:
- screenshot/error diagnosis
- UI description
- text visible in a screenshot
- ordinary photo understanding
- multi-image comparison
- follow-up question referring to the prior image
- leave/reopen while a vision job is running

Record cold-load latency separately from warm inference latency.
