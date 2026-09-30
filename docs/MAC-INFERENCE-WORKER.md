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

## 5. Async queue mode

The worker now polls CoOperative AI for queued image jobs. This is the preferred path for Local Fast and Local Quality because the generation can outlive a browser session or Cloudflare request timeout.

The production queue URL is the default, so if `INFERENCE_WORKER_TOKEN` is already set, no extra queue URL is required. To override it:

```bash
export COOPERATIVE_QUEUE_URL="https://co-operative-mu.vercel.app"
```

When the worker starts, health should show `"asyncQueue":{"configured":true,...}`.

The Mac must stay awake and the worker process must keep running, but CreatorHub may be closed while a job is processing.

## 6. Optional legacy direct tunnel

The Cloudflare tunnel remains useful for the older direct/synchronous worker route and diagnostics, but async queued generation does not depend on it.


In another Terminal window:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Cloudflare will print a temporary `https://...trycloudflare.com` URL.

That URL is temporary and changes when the tunnel restarts.

## 7. Configure CoOperative AI

In the CoOperative Vercel project, configure server-side environment variables:

```text
INFERENCE_LOCAL_URL=<the trycloudflare URL>
INFERENCE_LOCAL_TOKEN=<same INFERENCE_WORKER_TOKEN used on the Mac>
COOPERATIVE_INFERENCE_SHARED_SECRET=<a separate random secret>
SUPABASE_SERVICE_ROLE_KEY=<CoOperative Supabase service-role key; server-only>
```

Redeploy CoOperative after changing environment variables.

## 8. Configure CreatorHub

In the CreatorHub Vercel project, configure:

```text
COOPERATIVE_INFERENCE_URL=<production CoOperative origin>
COOPERATIVE_INFERENCE_SECRET=<same COOPERATIVE_INFERENCE_SHARED_SECRET>
```

Redeploy CreatorHub.

After this, CreatorHub image requests flow:

```text
CreatorHub -> CoOperative AI queue -> Mac/MPS worker -> CoOperative AI storage -> CreatorHub
```

Queued local jobs remain persisted while CreatorHub is closed. The Mac claims them when its worker is online. Manual local jobs never silently fall through to a paid hosted model.

## Safety

- Never expose the worker without `INFERENCE_WORKER_TOKEN`.
- Do not commit secrets.
- Keep Hugging Face and worker tokens in local/server environment variables only.
- Keep the radio/Nextcloud VPS separate from this test.
- The Mac is an optional worker; CoOperative should not depend on it being online.


## 9. Local text / LLM worker

CoOperative AI also has a separate outbound-polling MLX text worker. It uses the same `INFERENCE_WORKER_TOKEN` and production queue URL, so it does not require a Cloudflare tunnel.

Initial profiles:

```text
Local Fast    mlx-community/Qwen3-4B-Instruct-2507-4bit
Local Quality mlx-community/Qwen2.5-7B-Instruct-4bit
```

Both are environment-overridable:

```bash
export TEXT_FAST_MODEL_ID="mlx-community/Qwen3-4B-Instruct-2507-4bit"
export TEXT_QUALITY_MODEL_ID="mlx-community/Qwen2.5-7B-Instruct-4bit"
uv run workers/mlx-text-worker.py
```

The first use of each profile downloads the model. The worker loads only one text profile at a time and unloads the previous text model when switching profiles.

On the current 16 GB M1 test machine, validate image and text workloads separately first. Do not keep a large image model and Local Quality LLM busy simultaneously until memory behavior has been measured.

Text jobs flow:

```text
approved caller -> CoOperative AI text queue -> Mac/MLX worker
                -> CoOperative AI result -> caller
```

See `docs/LOCAL-TEXT-BENCHMARK.md` before promoting a replacement model.
