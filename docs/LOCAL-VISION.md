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

No image attachment is made public, and this path has no paid-model fallback.

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
