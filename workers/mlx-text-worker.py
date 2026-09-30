# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
#   "mlx-lm>=0.24.0",
#   "mlx-vlm>=0.1.21",
# ]
# ///

import gc
import os
import platform
import socket
import tempfile
import time
from pathlib import Path
from typing import Literal

import httpx
from mlx_lm import load as text_load
from mlx_lm import stream_generate as text_stream_generate
from mlx_lm.sample_utils import make_sampler

FAST_MODEL_ID = os.getenv(
    "TEXT_FAST_MODEL_ID",
    "mlx-community/Qwen3-4B-Instruct-2507-4bit",
)
QUALITY_MODEL_ID = os.getenv(
    "TEXT_QUALITY_MODEL_ID",
    "mlx-community/Qwen2.5-7B-Instruct-4bit",
)
VISION_MODEL_ID = os.getenv(
    "TEXT_VISION_MODEL_ID",
    "mlx-community/Qwen2.5-VL-3B-Instruct-4bit",
)

QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
QUEUE_POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_TEXT_QUEUE_POLL_SECONDS", "3")))
WORKER_TOKEN = os.getenv("INFERENCE_WORKER_TOKEN")
WORKER_ID = os.getenv("COOPERATIVE_TEXT_WORKER_ID", f"{socket.gethostname()}-text")[:160]

PROFILE_MODELS = {
    "fast": FAST_MODEL_ID,
    "quality": QUALITY_MODEL_ID,
}

loaded_key: str | None = None
loaded_model = None
loaded_processor = None
loaded_vlm_config = None


class JobCancelled(Exception):
    pass


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
    global loaded_key, loaded_model, loaded_processor, loaded_vlm_config
    loaded_model = None
    loaded_processor = None
    loaded_vlm_config = None
    loaded_key = None
    gc.collect()

    try:
        import mlx.core as mx

        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
    except Exception:
        pass


def ensure_text_profile(profile: Literal["fast", "quality"]):
    global loaded_key, loaded_model, loaded_processor

    key = f"text:{profile}"
    if loaded_key == key and loaded_model is not None and loaded_processor is not None:
        return

    clear_model()
    model_id = PROFILE_MODELS[profile]
    print(f"Loading local text model {model_id} ({profile})...")
    model, tokenizer = text_load(model_id)
    loaded_model = model
    loaded_processor = tokenizer
    loaded_key = key
    print(f"Loaded local text model {model_id}.")


def ensure_vision_model():
    global loaded_key, loaded_model, loaded_processor, loaded_vlm_config

    if loaded_key == "vision" and loaded_model is not None and loaded_processor is not None:
        return

    from mlx_vlm import load as vision_load
    from mlx_vlm.utils import load_config

    clear_model()
    print(f"Loading local vision model {VISION_MODEL_ID}...")
    model, processor = vision_load(VISION_MODEL_ID)
    loaded_model = model
    loaded_processor = processor
    loaded_vlm_config = load_config(VISION_MODEL_ID)
    loaded_key = "vision"
    print(f"Loaded local vision model {VISION_MODEL_ID}.")


def token_count(tokenizer, text: str) -> int | None:
    try:
        return len(tokenizer.encode(text))
    except Exception:
        return None


def clean_messages_from_job(job: dict):
    messages = job.get("messages")
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("Text job has no messages.")

    clean_messages = []
    for message in messages[:40]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"} or not isinstance(content, str):
            continue
        if not content.strip():
            continue
        clean_messages.append({"role": role, "content": content[:16000]})

    if not clean_messages:
        raise RuntimeError("Text job contains no valid messages.")

    return clean_messages


def generation_settings(job: dict):
    max_tokens = int(job.get("maxTokens") or 768)
    max_tokens = min(4096, max(16, max_tokens))
    temperature = float(job.get("temperature") if job.get("temperature") is not None else 0.2)
    temperature = min(2.0, max(0.0, temperature))
    return max_tokens, temperature


def post_progress(
    job_id: str,
    text: str,
    output_tokens: int | None,
    first_token_ms: int | None,
):
    payload: dict = {
        "jobId": job_id,
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
    return bool(result.get("cancelled"))


def consume_stream(job_id: str, stream, started: float):
    full_text = ""
    first_token_ms = None
    output_tokens = 0
    last_push_at = time.monotonic()
    last_push_length = 0
    last_response = None

    for response in stream:
        last_response = response
        piece = getattr(response, "text", "")
        if not isinstance(piece, str) or not piece:
            continue

        if full_text and piece.startswith(full_text) and len(piece) > len(full_text):
            full_text = piece
        else:
            full_text += piece

        output_tokens = int(
            getattr(
                response,
                "generation_tokens",
                getattr(response, "completion_tokens", output_tokens + 1),
            )
            or (output_tokens + 1)
        )

        if first_token_ms is None:
            first_token_ms = int((time.time() - started) * 1000)

        now = time.monotonic()
        should_push = (
            output_tokens == 1
            or now - last_push_at >= 0.8
            or len(full_text) - last_push_length >= 180
        )
        if should_push:
            if post_progress(job_id, full_text, output_tokens, first_token_ms):
                raise JobCancelled()
            last_push_at = now
            last_push_length = len(full_text)

    if full_text:
        if post_progress(job_id, full_text, output_tokens, first_token_ms):
            raise JobCancelled()

    return full_text, output_tokens, first_token_ms, last_response


def run_text_generation(job_id: str, job: dict, clean_messages: list[dict]):
    started = time.time()
    profile = str(job.get("profile", "fast"))
    if profile not in PROFILE_MODELS:
        raise RuntimeError(f"Unsupported text profile: {profile}")

    max_tokens, temperature = generation_settings(job)
    ensure_text_profile(profile)
    tokenizer = loaded_processor
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

    stream = text_stream_generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        sampler=sampler,
    )
    text, output_tokens, _, _ = consume_stream(job_id, stream, started)

    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Local text model returned an empty response.")

    return {
        "text": text.strip(),
        "model": model_id,
        "profile": profile,
        "provider": "cooperative-mlx-worker",
        "promptTokens": token_count(tokenizer, prompt),
        "outputTokens": output_tokens or token_count(tokenizer, text),
        "latencyMs": int((time.time() - started) * 1000),
    }


def attachment_suffix(content_type: str | None):
    if content_type and "png" in content_type:
        return ".png"
    if content_type and "webp" in content_type:
        return ".webp"
    return ".jpg"


def download_attachments(attachment_ids: list[str], directory: str):
    paths: list[str] = []

    for index, attachment_id in enumerate(attachment_ids[:4]):
        response = httpx.get(
            f"{QUEUE_URL}/api/inference/text/attachments",
            headers=queue_headers(),
            params={"id": attachment_id},
            timeout=60.0,
            follow_redirects=True,
        )
        response.raise_for_status()

        suffix = attachment_suffix(response.headers.get("content-type"))
        path = Path(directory) / f"image-{index + 1}{suffix}"
        path.write_bytes(response.content)
        paths.append(str(path))

    if not paths:
        raise RuntimeError("Vision job has no readable image attachments.")

    return paths


def vision_prompt(clean_messages: list[dict]):
    recent = clean_messages[-12:]
    lines = [
        "Use the attached image or images to answer the latest user request.",
        "Preserve relevant conversation context. If image details are uncertain, say so.",
        "",
        "Conversation:",
    ]
    for message in recent:
        role = str(message["role"]).capitalize()
        lines.append(f"{role}: {message['content']}")
    lines.append("Assistant:")
    return "\n".join(lines)


def run_vision_generation(
    job_id: str,
    job: dict,
    clean_messages: list[dict],
    attachment_ids: list[str],
):
    from mlx_vlm.generate import stream_generate as vision_stream_generate
    from mlx_vlm.prompt_utils import apply_chat_template

    started = time.time()
    profile = str(job.get("profile", "fast"))
    max_tokens, temperature = generation_settings(job)

    ensure_vision_model()
    model = loaded_model
    processor = loaded_processor
    config = loaded_vlm_config

    with tempfile.TemporaryDirectory(prefix="cooperative-vision-") as directory:
        image_paths = download_attachments(attachment_ids, directory)
        prompt = vision_prompt(clean_messages)
        formatted_prompt = apply_chat_template(
            processor,
            config,
            prompt,
            num_images=len(image_paths),
        )

        stream = vision_stream_generate(
            model,
            processor,
            formatted_prompt,
            image=image_paths,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text, output_tokens, _, last_response = consume_stream(job_id, stream, started)

    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Local vision model returned an empty response.")

    prompt_tokens = getattr(last_response, "prompt_tokens", None) if last_response else None

    return {
        "text": text.strip(),
        "model": VISION_MODEL_ID,
        "profile": profile,
        "provider": "cooperative-mlx-vlm-worker",
        "promptTokens": prompt_tokens,
        "outputTokens": output_tokens,
        "latencyMs": int((time.time() - started) * 1000),
    }


def run_generation(job_id: str, job: dict):
    clean_messages = clean_messages_from_job(job)
    attachment_ids = job.get("attachmentIds")
    if not isinstance(attachment_ids, list):
        attachment_ids = []

    capability = str(job.get("capability") or "text")
    if capability == "vision" or attachment_ids:
        return run_vision_generation(
            job_id,
            job,
            clean_messages,
            [str(value) for value in attachment_ids if value],
        )

    return run_text_generation(job_id, job, clean_messages)


def complete_job(job_id: str, payload: dict):
    response = httpx.post(
        f"{QUEUE_URL}/api/inference/text/jobs/complete",
        headers=queue_headers(),
        json={"jobId": job_id, **payload},
        timeout=60.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.json()


def queue_loop():
    print(f"CoOperative AI text queue polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    print(f"Text Fast: {FAST_MODEL_ID}")
    print(f"Text Quality: {QUALITY_MODEL_ID}")
    print(f"Vision: {VISION_MODEL_ID}")
    print("Live token progress enabled.")

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
            capability = job.get("capability", "text")
            print(f"Claimed async text job {job_id} ({profile}, {capability}).")

            result = run_generation(job_id, job)
            completion = complete_job(job_id, result)
            if completion.get("status") == "cancelled":
                print(f"Async text job {job_id} was cancelled.")
                continue

            print(
                f"Completed async text job {job_id} "
                f"in {result['latencyMs']} ms using {result['model']}."
            )
        except JobCancelled:
            print(f"Async text job {job_id} cancelled by user.")
            continue
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
