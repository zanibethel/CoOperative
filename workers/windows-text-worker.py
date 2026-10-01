# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
#   "torch>=2.5.0",
#   "transformers>=4.47.0",
# ]
# ///

"""Adaptive Windows text worker for CoOperative Unison.

Preferred backend is Ollama so Windows nodes can run quantized models sized to
their hardware. The existing Transformers path remains as a safe 1.5B fallback.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from unison_runtime import node_available

if platform.system() != "Windows":
    raise RuntimeError("The Windows text worker only runs on Windows.")

HERE = Path(__file__).resolve().parent
PLAN_PATH = HERE / "text-model-plan.json"
BENCHMARK_PATH = HERE / "text-benchmark.json"
READY_MARKER = HERE / "text-worker.ready"
BUSY_MARKER = HERE / "text-worker.busy"

QUEUE_URL = os.getenv(
    "COOPERATIVE_QUEUE_URL",
    "https://co-operative-mu.vercel.app",
).rstrip("/")
QUEUE_POLL_SECONDS = max(
    2,
    int(os.getenv("COOPERATIVE_TEXT_QUEUE_POLL_SECONDS", "3")),
)
WORKER_TOKEN = os.getenv("UNISON_NODE_TOKEN") or os.getenv("INFERENCE_WORKER_TOKEN")
WORKER_ID = (
    os.getenv("UNISON_NODE_ID")
    or os.getenv("COOPERATIVE_TEXT_WORKER_ID")
    or f"{socket.gethostname()}-text"
)[:160]

LEGACY_FAST_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"


def load_plan() -> dict:
    try:
        value = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


MODEL_PLAN = load_plan()
PLAN_MODELS = MODEL_PLAN.get("models") if isinstance(MODEL_PLAN.get("models"), dict) else {}
BACKEND = os.getenv("WINDOWS_TEXT_BACKEND") or str(MODEL_PLAN.get("backend") or "transformers")
FAST_MODEL_ID = os.getenv("WINDOWS_TEXT_FAST_MODEL_ID") or str(
    PLAN_MODELS.get("fast") or LEGACY_FAST_MODEL
)
QUALITY_MODEL_ID = os.getenv("WINDOWS_TEXT_QUALITY_MODEL_ID") or str(
    PLAN_MODELS.get("quality") or FAST_MODEL_ID
)
HEAVY_MODEL_ID = os.getenv("WINDOWS_TEXT_HEAVY_MODEL_ID") or str(
    PLAN_MODELS.get("heavy") or QUALITY_MODEL_ID
)
PROFILE_MODELS = {
    "fast": FAST_MODEL_ID,
    "quality": QUALITY_MODEL_ID,
}

loaded_model_id: str | None = None
loaded_model = None
loaded_tokenizer = None
ollama_process: subprocess.Popen | None = None


class JobCancelled(Exception):
    pass


def queue_headers():
    if not WORKER_TOKEN:
        raise RuntimeError("A Unison node token is required for text queue polling.")
    return {
        "Authorization": f"Bearer {WORKER_TOKEN}",
        "Content-Type": "application/json",
    }


def clean_messages(job: dict):
    messages = job.get("messages")
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("Text job has no messages.")

    cleaned = []
    for message in messages[:40]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"}:
            continue
        if not isinstance(content, str) or not content.strip():
            continue
        cleaned.append({"role": role, "content": content[:16000]})

    if not cleaned:
        raise RuntimeError("Text job contains no valid messages.")
    return cleaned


def generation_settings(job: dict):
    max_tokens = int(job.get("maxTokens") or 768)
    max_tokens = min(4096, max(16, max_tokens))
    temperature = float(
        job.get("temperature")
        if job.get("temperature") is not None
        else 0.2
    )
    temperature = min(2.0, max(0.0, temperature))
    return max_tokens, temperature


def ollama_executable() -> str | None:
    configured = os.getenv("UNISON_OLLAMA_EXE")
    if configured and Path(configured).is_file():
        return configured

    direct = shutil.which("ollama")
    if direct:
        return direct

    candidates = [
        Path(os.getenv("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path(os.getenv("PROGRAMFILES", "")) / "Ollama" / "ollama.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def ollama_ready() -> bool:
    try:
        response = httpx.get("http://127.0.0.1:11434/api/version", timeout=2.5)
        return response.is_success
    except Exception:
        return False


def ensure_ollama_server() -> None:
    global ollama_process

    if ollama_ready():
        return

    executable = ollama_executable()
    if not executable:
        raise RuntimeError("Ollama is not installed on this Windows node.")

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    ollama_process = subprocess.Popen(
        [executable, "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    deadline = time.time() + 30
    while time.time() < deadline:
        if ollama_ready():
            return
        if ollama_process.poll() is not None:
            break
        time.sleep(1)

    raise RuntimeError("Ollama did not become ready within 30 seconds.")


def ensure_ollama_model(model_id: str) -> None:
    ensure_ollama_server()
    try:
        tags = httpx.get("http://127.0.0.1:11434/api/tags", timeout=10).json()
        names = {
            str(model.get("name") or "")
            for model in tags.get("models", [])
            if isinstance(model, dict)
        }
        if model_id in names or any(name.startswith(f"{model_id}:") for name in names):
            return
    except Exception:
        pass

    print(f"Pulling adaptive Windows text model {model_id}...", flush=True)
    response = httpx.post(
        "http://127.0.0.1:11434/api/pull",
        json={"name": model_id, "stream": False},
        timeout=None,
    )
    response.raise_for_status()
    print(f"Model {model_id} is ready.", flush=True)


def save_benchmark(
    *,
    profile: str,
    model: str,
    provider: str,
    output_tokens: int,
    latency_ms: int,
    tokens_per_second: float | None,
) -> None:
    payload = {
        "profile": profile,
        "model": model,
        "provider": provider,
        "outputTokens": output_tokens,
        "latencyMs": latency_ms,
        "tokensPerSecond": (
            round(tokens_per_second, 2)
            if isinstance(tokens_per_second, (int, float)) and tokens_per_second > 0
            else None
        ),
        "recordedAt": datetime.now(timezone.utc).isoformat(),
    }
    try:
        BENCHMARK_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"Could not persist text benchmark: {exc}", flush=True)


def run_ollama_generation(
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    temperature: float,
    profile: str,
) -> dict:
    ensure_ollama_model(model_id)
    started = time.time()
    response = httpx.post(
        "http://127.0.0.1:11434/api/chat",
        json={
            "model": model_id,
            "messages": messages,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
                "top_p": 0.9,
            },
        },
        timeout=None,
    )
    response.raise_for_status()
    body = response.json()
    text = str((body.get("message") or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Ollama returned an empty response.")

    input_tokens = int(body.get("prompt_eval_count") or 0)
    output_tokens = int(body.get("eval_count") or 0)
    latency_ms = int((time.time() - started) * 1000)
    eval_duration_ns = int(body.get("eval_duration") or 0)
    tokens_per_second = (
        output_tokens / (eval_duration_ns / 1_000_000_000)
        if output_tokens > 0 and eval_duration_ns > 0
        else None
    )
    save_benchmark(
        profile=profile,
        model=model_id,
        provider="ollama-windows",
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        tokens_per_second=tokens_per_second,
    )

    return {
        "text": text,
        "model": model_id,
        "profile": profile,
        "provider": "ollama-windows",
        "promptTokens": input_tokens,
        "outputTokens": output_tokens,
        "latencyMs": latency_ms,
    }


def ensure_transformers_model():
    global loaded_model_id, loaded_model, loaded_tokenizer

    if loaded_model_id == LEGACY_FAST_MODEL and loaded_model is not None:
        return loaded_model, loaded_tokenizer

    print(f"Loading fallback Windows model {LEGACY_FAST_MODEL}...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(LEGACY_FAST_MODEL)
    model = AutoModelForCausalLM.from_pretrained(
        LEGACY_FAST_MODEL,
        torch_dtype=torch.float32,
    )
    model.eval()
    loaded_model_id = LEGACY_FAST_MODEL
    loaded_model = model
    loaded_tokenizer = tokenizer
    return model, tokenizer


def run_transformers_generation(
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    profile: str,
) -> dict:
    model, tokenizer = ensure_transformers_model()
    started = time.time()
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    encoded = tokenizer(prompt, return_tensors="pt")
    input_tokens = int(encoded["input_ids"].shape[-1])

    generation_args = {
        **encoded,
        "max_new_tokens": max_tokens,
        "pad_token_id": tokenizer.eos_token_id,
    }
    if temperature > 0:
        generation_args.update(
            {
                "do_sample": True,
                "temperature": max(0.05, temperature),
                "top_p": 0.9,
            }
        )
    else:
        generation_args["do_sample"] = False

    with torch.inference_mode():
        output = model.generate(**generation_args)

    generated = output[0][input_tokens:]
    text = tokenizer.decode(generated, skip_special_tokens=True).strip()
    if not text:
        raise RuntimeError("Windows fallback text model returned an empty response.")

    output_tokens = int(generated.shape[-1])
    latency_ms = int((time.time() - started) * 1000)
    tps = output_tokens / max(0.001, latency_ms / 1000)
    save_benchmark(
        profile=profile,
        model=LEGACY_FAST_MODEL,
        provider="cooperative-transformers-windows-fallback",
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        tokens_per_second=tps,
    )
    return {
        "text": text,
        "model": LEGACY_FAST_MODEL,
        "profile": profile,
        "provider": "cooperative-transformers-windows-fallback",
        "promptTokens": input_tokens,
        "outputTokens": output_tokens,
        "latencyMs": latency_ms,
    }


def post_progress(
    job_id: str,
    text: str,
    output_tokens: int | None = None,
    first_token_ms: int | None = None,
):
    payload: dict = {
        "jobId": job_id,
        "workerId": WORKER_ID,
        "text": text,
    }
    if output_tokens is not None:
        payload["outputTokens"] = output_tokens
    if first_token_ms is not None:
        payload["firstTokenMs"] = first_token_ms

    response = httpx.post(
        f"{QUEUE_URL}/api/inference/text/jobs/progress",
        headers=queue_headers(),
        json=payload,
        timeout=30.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    result = response.json()
    if result.get("cancelled"):
        raise JobCancelled()


def complete_job(job_id: str, payload: dict):
    response = httpx.post(
        f"{QUEUE_URL}/api/inference/text/jobs/complete",
        headers=queue_headers(),
        json={"jobId": job_id, "workerId": WORKER_ID, **payload},
        timeout=60.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.json()


def run_generation(job_id: str, job: dict):
    if job.get("capability") == "vision" or job.get("attachmentIds"):
        raise RuntimeError(
            "This Windows text worker does not provide vision yet. "
            "Route image attachments to a vision-capable owned node."
        )

    messages = clean_messages(job)
    max_tokens, temperature = generation_settings(job)
    profile = "quality" if job.get("profile") == "quality" else "fast"
    model_id = PROFILE_MODELS[profile]

    post_progress(job_id, "", 0, None)

    if BACKEND.lower() == "ollama":
        try:
            result = run_ollama_generation(
                messages,
                model_id,
                max_tokens,
                temperature,
                profile,
            )
        except Exception as exc:
            print(
                f"Adaptive Ollama execution failed ({exc}); using safe 1.5B fallback.",
                flush=True,
            )
            result = run_transformers_generation(
                messages,
                max_tokens,
                temperature,
                profile,
            )
    else:
        result = run_transformers_generation(
            messages,
            max_tokens,
            temperature,
            profile,
        )

    post_progress(
        job_id,
        result["text"],
        int(result["outputTokens"]),
        None,
    )
    return result


def set_busy(value: bool):
    if value:
        BUSY_MARKER.write_text(str(os.getpid()), encoding="utf-8")
    else:
        try:
            BUSY_MARKER.unlink()
        except FileNotFoundError:
            pass


def queue_loop():
    print(
        f"CoOperative Windows text queue polling enabled for {QUEUE_URL} as {WORKER_ID}.",
        flush=True,
    )
    print(
        f"Adaptive text backend: {BACKEND}; fast={FAST_MODEL_ID}; "
        f"quality={QUALITY_MODEL_ID}; heavy={HEAVY_MODEL_ID}",
        flush=True,
    )

    READY_MARKER.write_text(str(os.getpid()), encoding="utf-8")
    print("UNISON_TEXT_RUNTIME_STARTED", flush=True)

    while True:
        job_id = None
        try:
            if not node_available():
                time.sleep(QUEUE_POLL_SECONDS)
                continue

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
            print(
                f"Claimed async text job {job_id} "
                f"({job.get('profile', 'fast')}, {job.get('capability', 'text')}).",
                flush=True,
            )

            set_busy(True)
            try:
                result = run_generation(job_id, job)
                completion = complete_job(job_id, result)
            finally:
                set_busy(False)

            if completion.get("status") == "cancelled":
                print(f"Async text job {job_id} was cancelled.", flush=True)
            else:
                print(
                    f"Completed async text job {job_id} in "
                    f"{result['latencyMs']} ms using {result['model']}.",
                    flush=True,
                )
        except JobCancelled:
            set_busy(False)
            print(f"Async text job {job_id} cancelled by user.", flush=True)
        except KeyboardInterrupt:
            set_busy(False)
            return
        except Exception as exc:
            set_busy(False)
            message = str(exc)[:1000]
            print(f"Async text queue error: {message}", flush=True)
            if job_id:
                try:
                    complete_job(job_id, {"error": message})
                except Exception as completion_exc:
                    print(
                        f"Could not report text failure for {job_id}: {completion_exc}",
                        flush=True,
                    )
            time.sleep(QUEUE_POLL_SECONDS)


if __name__ == "__main__":
    if not WORKER_TOKEN:
        raise RuntimeError("UNISON_NODE_TOKEN is required.")

    try:
        queue_loop()
    except BaseException as exc:
        print(
            f"UNISON_TEXT_FATAL:{type(exc).__name__}:{str(exc)[:700]}",
            file=sys.stderr,
            flush=True,
        )
        raise
    finally:
        set_busy(False)
        try:
            READY_MARKER.unlink()
        except FileNotFoundError:
            pass
