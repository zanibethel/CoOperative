# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
#   "mlx-lm>=0.24.0",
# ]
# ///

import gc
import os
import platform
import socket
import time
from typing import Literal

import httpx
from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

FAST_MODEL_ID = os.getenv(
    "TEXT_FAST_MODEL_ID",
    "mlx-community/Qwen3-4B-Instruct-2507-4bit",
)
QUALITY_MODEL_ID = os.getenv(
    "TEXT_QUALITY_MODEL_ID",
    "mlx-community/Qwen2.5-7B-Instruct-4bit",
)

QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
QUEUE_POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_TEXT_QUEUE_POLL_SECONDS", "3")))
WORKER_TOKEN = os.getenv("INFERENCE_WORKER_TOKEN")
WORKER_ID = os.getenv("COOPERATIVE_TEXT_WORKER_ID", f"{socket.gethostname()}-text")[:160]

PROFILE_MODELS = {
    "fast": FAST_MODEL_ID,
    "quality": QUALITY_MODEL_ID,
}

loaded_profile: str | None = None
loaded_model = None
loaded_tokenizer = None


def require_supported_mac():
    if platform.system() != "Darwin" or platform.machine() not in {"arm64", "aarch64"}:
        raise RuntimeError(
            "The MLX text worker requires Apple Silicon macOS. "
            "Use a different text worker backend on non-Apple hardware."
        )


def queue_headers():
    if not WORKER_TOKEN:
        raise RuntimeError("INFERENCE_WORKER_TOKEN is required for text queue polling.")
    return {
        "Authorization": f"Bearer {WORKER_TOKEN}",
        "Content-Type": "application/json",
    }


def clear_model():
    global loaded_profile, loaded_model, loaded_tokenizer
    loaded_model = None
    loaded_tokenizer = None
    loaded_profile = None
    gc.collect()

    try:
        import mlx.core as mx

        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
    except Exception:
        pass


def ensure_profile(profile: Literal["fast", "quality"]):
    global loaded_profile, loaded_model, loaded_tokenizer

    if loaded_profile == profile and loaded_model is not None and loaded_tokenizer is not None:
        return

    clear_model()
    model_id = PROFILE_MODELS[profile]
    print(f"Loading local text model {model_id} ({profile})...")
    model, tokenizer = load(model_id)
    loaded_model = model
    loaded_tokenizer = tokenizer
    loaded_profile = profile
    print(f"Loaded local text model {model_id}.")


def token_count(tokenizer, text: str) -> int | None:
    try:
        return len(tokenizer.encode(text))
    except Exception:
        return None


def run_generation(job: dict):
    started = time.time()
    profile = str(job.get("profile", "fast"))
    if profile not in PROFILE_MODELS:
        raise RuntimeError(f"Unsupported text profile: {profile}")

    messages = job.get("messages")
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("Text job has no messages.")

    clean_messages = []
    for message in messages[:40]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"} or not isinstance(content, str) or not content.strip():
            continue
        clean_messages.append({"role": role, "content": content[:16000]})

    if not clean_messages:
        raise RuntimeError("Text job contains no valid messages.")

    max_tokens = int(job.get("maxTokens") or 768)
    max_tokens = min(4096, max(16, max_tokens))
    temperature = float(job.get("temperature") if job.get("temperature") is not None else 0.2)
    temperature = min(2.0, max(0.0, temperature))

    ensure_profile(profile)
    tokenizer = loaded_tokenizer
    model = loaded_model
    model_id = PROFILE_MODELS[profile]

    prompt = tokenizer.apply_chat_template(
        clean_messages,
        add_generation_prompt=True,
        tokenize=False,
    )
    sampler = make_sampler(
        temp=temperature,
        top_p=0.95 if temperature > 0 else 1.0,
    )

    text = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        sampler=sampler,
        verbose=False,
    )
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Local text model returned an empty response.")

    return {
        "text": text.strip(),
        "model": model_id,
        "profile": profile,
        "provider": "cooperative-mlx-worker",
        "promptTokens": token_count(tokenizer, prompt),
        "outputTokens": token_count(tokenizer, text),
        "latencyMs": int((time.time() - started) * 1000),
    }


def complete_job(job_id: str, payload: dict):
    response = httpx.post(
        f"{QUEUE_URL}/api/inference/text/jobs/complete",
        headers=queue_headers(),
        json={"jobId": job_id, **payload},
        timeout=60.0,
        follow_redirects=True,
    )
    response.raise_for_status()


def queue_loop():
    print(f"CoOperative AI text queue polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    print(f"Text Fast: {FAST_MODEL_ID}")
    print(f"Text Quality: {QUALITY_MODEL_ID}")

    while True:
        job_id = None
        try:
            response = httpx.post(
                f"{QUEUE_URL}/api/inference/text/jobs/claim",
                headers=queue_headers(),
                json={"workerId": WORKER_ID},
                timeout=30.0,
                follow_redirects=True,
            )

            if response.status_code == 204:
                time.sleep(QUEUE_POLL_SECONDS)
                continue

            response.raise_for_status()
            job = response.json()
            job_id = str(job["jobId"])
            profile = job.get("profile", "fast")
            print(f"Claimed async text job {job_id} ({profile}).")

            result = run_generation(job)
            complete_job(job_id, result)
            print(
                f"Completed async text job {job_id} "
                f"in {result['latencyMs']} ms using {result['model']}."
            )
        except KeyboardInterrupt:
            print("Text worker stopped.")
            return
        except Exception as exc:
            message = str(exc)[:1000]
            print(f"Async text queue error: {message}")
            if job_id:
                try:
                    complete_job(job_id, {"error": message})
                except Exception as completion_exc:
                    print(f"Could not report failure for {job_id}: {completion_exc}")
            time.sleep(QUEUE_POLL_SECONDS)


if __name__ == "__main__":
    require_supported_mac()
    if not QUEUE_URL:
        raise RuntimeError("COOPERATIVE_QUEUE_URL is required.")
    if not WORKER_TOKEN:
        raise RuntimeError("INFERENCE_WORKER_TOKEN is required.")

    queue_loop()
