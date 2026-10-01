# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
#   "torch>=2.5.0",
#   "transformers>=4.47.0",
# ]
# ///

"""Windows/CPU text worker for CoOperative Unison.

This worker intentionally reuses the existing async text queue. The image worker
remains the node heartbeat owner on Windows so a single node publishes one
combined capability snapshot instead of two workers racing to overwrite it.
"""

from __future__ import annotations

import os
import platform
import socket
import time
from pathlib import Path

import httpx
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from unison_runtime import node_available

if platform.system() != "Windows":
    raise RuntimeError("The Windows text worker only runs on Windows.")

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

FAST_MODEL_ID = os.getenv(
    "WINDOWS_TEXT_FAST_MODEL_ID",
    "Qwen/Qwen2.5-1.5B-Instruct",
)
QUALITY_MODEL_ID = os.getenv(
    "WINDOWS_TEXT_QUALITY_MODEL_ID",
    "Qwen/Qwen2.5-1.5B-Instruct",
)
PROFILE_MODELS = {
    "fast": FAST_MODEL_ID,
    "quality": QUALITY_MODEL_ID,
}

READY_MARKER = Path(__file__).with_name("text-worker.ready")
BUSY_MARKER = Path(__file__).with_name("text-worker.busy")

loaded_model_id: str | None = None
loaded_model = None
loaded_tokenizer = None


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


def ensure_model(profile: str):
    global loaded_model_id, loaded_model, loaded_tokenizer

    model_id = PROFILE_MODELS["quality" if profile == "quality" else "fast"]
    if loaded_model_id == model_id and loaded_model is not None:
        return loaded_model, loaded_tokenizer, model_id

    print(f"Loading Windows local text model {model_id}...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.float32,
    )
    model.eval()

    loaded_model_id = model_id
    loaded_model = model
    loaded_tokenizer = tokenizer
    print(f"Loaded Windows local text model {model_id}.", flush=True)
    return model, tokenizer, model_id


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
    model, tokenizer, model_id = ensure_model(profile)

    started = time.time()
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    encoded = tokenizer(prompt, return_tensors="pt")
    input_tokens = int(encoded["input_ids"].shape[-1])

    post_progress(job_id, "", 0, None)

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
        raise RuntimeError("Windows local text model returned an empty response.")

    output_tokens = int(generated.shape[-1])
    latency_ms = int((time.time() - started) * 1000)
    post_progress(job_id, text, output_tokens, None)

    return {
        "text": text,
        "model": model_id,
        "profile": profile,
        "provider": "cooperative-transformers-windows",
        "promptTokens": input_tokens,
        "outputTokens": output_tokens,
        "latencyMs": latency_ms,
    }


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
    print(f"Text model: {FAST_MODEL_ID}", flush=True)

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
    finally:
        set_busy(False)
        try:
            READY_MARKER.unlink()
        except FileNotFoundError:
            pass
