# Local Worker Supervisor

The CoOperative local supervisor manages the Mac-side workers so the owner does not have to keep track of separate text, image, and repo-agent terminals.

## Command

```bash
uv run workers/local-supervisor.py
```

The supervisor reads `INFERENCE_WORKER_TOKEN` from the environment when present. Otherwise, on macOS it reads the token from Keychain service:

```text
cooperative-inference-worker
```

The token is never printed.

## Processes

The supervisor keeps the lightweight repo agent available:

- `workers/repo-agent-worker.py`

It owns exactly one heavy inference worker at a time:

- text + vision: `workers/mlx-text-worker.py`
- image generation: `workers/hf-image-worker.py`

The image worker is started with `PRELOAD_PROFILE=none` so it does not load an unnecessary image model before claiming the queued job.

## Scheduling policy

- A currently running inference job is never intentionally interrupted to switch modalities.
- Queued text/vision work has priority when the text worker is active.
- When text work drains and image work is waiting, the supervisor stops the idle text worker and starts image generation.
- When an image job finishes, queued text work causes a switch back to the text worker.
- With no queued work, the supervisor defaults to the text worker because it is lazy-loading and can sit idle without loading a model.
- The repo agent remains separate and lightweight; any Local AI reasoning it requests is sent through the existing text queue.

This keeps the 16 GB M1 from intentionally running the MLX text/vision stack and the PyTorch image-generation stack at the same time.

## Duplicate-worker protection

At startup, the supervisor checks for existing standalone:

- `mlx-text-worker.py`
- `hf-image-worker.py`
- `repo-agent-worker.py`

If any are already running, the supervisor exits rather than creating competing workers. Stop those existing worker terminals with Ctrl+C, then start the supervisor.

## Queue state

The supervisor reads the authenticated endpoint:

```text
GET /api/inference/local-queue/status
```

It receives only queue counts and oldest queued timestamps for text and image work. It does not claim work itself; the specialized worker claims jobs after the supervisor starts it.

## Failure behavior

If a child worker exits, the supervisor recreates the needed worker on the next polling cycle. If the production queue status endpoint is temporarily unavailable, it logs the error and retries without touching running children.

## Boundaries

The supervisor does not:
- expose or rotate secrets;
- push Git branches;
- deploy production;
- approve agent changes;
- interrupt an active image/text job for routine switching;
- enable hosted/paid fallback.
