# Local image benchmark

CoOperative AI keeps local image generation measurable instead of promoting a model because it merely looks newer.

## Profiles

### Local Fast
- Default model: `stable-diffusion-v1-5/stable-diffusion-v1-5`
- Purpose: quick drafts, iteration, fallback-safe local generation
- Current reference method: image-to-image with the primary approved reference
- No per-image API fee

### Local Quality
- Default model: `segmind/SSD-1B`
- Purpose: better realism, detail, anatomy, and prompt fidelity on the current 16 GB Apple Silicon test machine
- Architecture: distilled SDXL-class pipeline
- Current reference method: image-to-image with the primary approved reference
- No per-image API fee
- First use downloads the quality model and may take several minutes

Both model IDs are environment-overridable. A candidate should only replace a default after it wins the same benchmark prompts without unacceptable latency or memory failures.

## Creator benchmark prompts

Run the same approved creator reference through both profiles.

1. **Golden-hour portrait**
   - "Standing outdoors at golden hour in a casual denim outfit, realistic photography, warm natural light, natural skin texture."

2. **Night portrait**
   - "Candid nighttime portrait, laughing at something off camera, warm patio lights, premium lifestyle photography."

3. **Full-body anatomy**
   - "Full-body lifestyle photo walking beside a ranch fence, fitted jeans, simple top, relaxed natural stride, realistic hands and anatomy."

4. **Indoor detail**
   - "Natural indoor kitchen portrait preparing coffee beside a window, soft morning light, realistic hands, detailed hair and skin."

5. **Pose change**
   - "Seated sideways on a porch chair, one hand resting naturally on the chair arm, looking toward camera, shallow depth of field."

## Score each result

Use a 1–5 score for:
- identity similarity
- photorealism
- hands/anatomy
- prompt adherence
- background/detail quality

Also record:
- generation latency
- peak-memory or out-of-memory failure
- black/blank output
- model/profile
- reference count actually used

Do not save benchmark generations as approved character references unless they genuinely improve the identity library.

## Promotion rule

Promote a new local model only when it materially improves the benchmark while remaining reliable on the target hardware. Keep the previous model available for rollback.

Future identity work should test IP-Adapter/FaceID/LoRA-style reference conditioning so multiple approved references can contribute without relying only on img2img.
