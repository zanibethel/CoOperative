# Mac inference worker quick test

This is the fastest way to use an Apple Silicon Mac as a CoOperative image worker.

## 1. Check the Mac

Run:

```bash
system_profiler SPHardwareDataType | egrep 'Chip|Memory'
```

Apple Silicon (M1/M2/M3/M4) is preferred.

## 2. Install prerequisites

If Homebrew is already installed:

```bash
brew install git uv cloudflared
```

Clone CoOperative and enter the repo:

```bash
git clone https://github.com/zanibethel/CoOperative.git
cd CoOperative
```

## 3. Optional: authenticate Hugging Face

Public models can download without authentication, but an authenticated token gives higher Hub rate limits and is required by some gated/private models.

Create or use a read-only Hugging Face token, then set it locally:

```bash
export HF_TOKEN="<your private Hugging Face token>"
```

Never paste the token into chat or commit it to GitHub.

## 4. Start the worker

Create a private random worker token. Do not paste it into chat.

```bash
export INFERENCE_WORKER_TOKEN="$(openssl rand -hex 32)"
export PYTORCH_ENABLE_MPS_FALLBACK=1
uv run workers/hf-image-worker.py
```

The first start downloads dependencies and the selected model and can take several minutes.

The worker includes `torchvision` for the normal Transformers image-processing backend and uses Diffusers' current `dtype` parameter instead of the deprecated `torch_dtype` parameter.

In a second Terminal window:

```bash
curl http://127.0.0.1:8000/health
```

For Apple Silicon, the response should report `"device":"mps"` and `"dtype":"float32"`. If `HF_TOKEN` is set, it will also report `"huggingFaceAuthenticated":true`.

## 5. Expose it temporarily to CoOperative AI

In another Terminal window:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Cloudflare will print a temporary `https://...trycloudflare.com` URL.

That URL is temporary and changes when the tunnel restarts.

## 6. Configure CoOperative AI

In the CoOperative Vercel project, configure server-side environment variables:

```text
INFERENCE_LOCAL_URL=<the trycloudflare URL>
INFERENCE_LOCAL_TOKEN=<same INFERENCE_WORKER_TOKEN used on the Mac>
COOPERATIVE_INFERENCE_SHARED_SECRET=<a separate random secret>
```

Redeploy CoOperative after changing environment variables.

## 7. Configure CreatorHub

In the CreatorHub Vercel project, configure:

```text
COOPERATIVE_INFERENCE_URL=<production CoOperative origin>
COOPERATIVE_INFERENCE_SECRET=<same COOPERATIVE_INFERENCE_SHARED_SECRET>
```

Redeploy CreatorHub.

After this, CreatorHub image requests flow:

```text
CreatorHub -> CoOperative AI -> Mac/MPS worker
```

If the Mac is offline or the temporary tunnel has ended, CoOperative can fall through to another configured worker/provider.

## Safety

- Never expose the worker without `INFERENCE_WORKER_TOKEN`.
- Do not commit secrets.
- Keep Hugging Face and worker tokens in local/server environment variables only.
- Keep the radio/Nextcloud VPS separate from this test.
- The Mac is an optional worker; CoOperative should not depend on it being online.
