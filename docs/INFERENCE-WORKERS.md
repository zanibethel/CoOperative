# CoOperative Inference Workers

## Goal

CoOperative should make local/self-hosted inference the default low-marginal-cost option for both Hermes/Cloud Operative reasoning and CreatorHub media generation.

The provider is replaceable. Callers ask for a capability.

```text
CreatorHub / Hermes / CoOperative
          |
          v
   CoOperative capability router
          |
     +----+-------------------+
     |                        |
 local worker first       temporary cloud GPU
     |                        |
     +-----------+------------+
                 |
          paid API fallback
          only when permitted
```

## Current v1 contract

The first implemented capability is image generation:

`POST /api/inference/image`

CoOperative requires:

`Authorization: Bearer $COOPERATIVE_INFERENCE_SHARED_SECRET`

The router tries:

1. `INFERENCE_LOCAL_URL`
2. `INFERENCE_CLOUD_URL`

Each worker implements:

- `GET /health`
- `GET /capabilities`
- `POST /v1/images/generate`

Reference images are passed as data URLs so private CreatorHub assets do not need to be made public.

## Temporary Hugging Face GPU worker

`workers/hf-image-worker.py` is a disposable proof-of-concept GPU worker.

It defaults to Stable Diffusion 1.5 and supports:

- text-to-image
- one reference image through image-to-image
- 1:1, 4:5, 3:2, 16:9, and 9:16 output shapes
- an HTTP endpoint compatible with CoOperative's inference router

It intentionally does not disable the base model's safety components.

A Hugging Face Job can expose port 8000. The exposed URL requires a Hugging Face token with read access to the Job namespace. Store that token only in the server-side `INFERENCE_CLOUD_TOKEN` secret.

Example shape after an owner-approved launch:

```text
INFERENCE_CLOUD_URL=https://<job-id>--8000.hf.jobs
INFERENCE_CLOUD_TOKEN=<server-side HF token>
```

Do not commit token values.

## Spend governance

Cloud GPU launch is a paid resource and must obey the existing owner cost gate.

Do not automatically start a GPU merely because local inference failed.

A cloud worker should have:

- an explicit hardware flavor
- an explicit timeout
- a maximum approved spend
- an automatic stop condition
- evidence/cost recorded in CoOperative

Once a local machine is available, set `INFERENCE_LOCAL_URL` and CoOperative will prefer it automatically.

## Next capabilities

The same worker registry should later support:

- `text_generation`
- `coding`
- `vision`
- `embeddings`
- `image_generation`
- `image_to_image`
- `fine_tuning`

Hermes should use the same capability router instead of being tied to a specific hosted model.
