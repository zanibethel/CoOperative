# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "accelerate>=1.2.0",
#   "diffusers>=0.35.0",
#   "fastapi>=0.115.0",
#   "httpx>=0.28.0",
#   "pillow>=11.0.0",
#   "safetensors>=0.5.0",
#   "torch>=2.5.0",
#   "torchvision>=0.20.0",
#   "transformers>=4.47.0",
#   "uvicorn[standard]>=0.34.0",
# ]
# ///

import base64
import gc
import io
import os
import socket
import threading
import time
from typing import Literal

import httpx
import torch
import uvicorn
from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

FAST_MODEL_ID = os.getenv(
    "FAST_MODEL_ID",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
)
QUALITY_MODEL_ID = os.getenv(
    "QUALITY_MODEL_ID",
    "segmind/SSD-1B",
)

if torch.cuda.is_available():
    DEVICE = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32
WORKER_TOKEN = os.getenv("INFERENCE_WORKER_TOKEN")
QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
QUEUE_POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_QUEUE_POLL_SECONDS", "3")))
WORKER_ID = os.getenv("COOPERATIVE_WORKER_ID", socket.gethostname())[:160]
PRELOAD_PROFILE = os.getenv("PRELOAD_PROFILE", "fast").lower()
if PRELOAD_PROFILE not in {"fast", "quality", "none"}:
    PRELOAD_PROFILE = "fast"

app = FastAPI(title="CoOperative AI Local Image Worker", version="0.5.0")

MODEL_LOCK = threading.Lock()
loaded_profile: str | None = None
text_pipe = None
image_pipe = None

PROFILE_CONFIG = {
    "fast": {
        "model": FAST_MODEL_ID,
        "steps": 28,
        "guidance": 7.0,
        "strength": 0.62,
        "dimensions": {
            "1:1": (512, 512),
            "4:5": (512, 640),
            "3:2": (768, 512),
            "16:9": (768, 432),
            "9:16": (432, 768),
        },
    },
    "quality": {
        "model": QUALITY_MODEL_ID,
        "steps": 25,
        "guidance": 9.0,
        "strength": 0.58,
        "dimensions": {
            "1:1": (768, 768),
            "4:5": (768, 960),
            "3:2": (960, 640),
            "16:9": (1024, 576),
            "9:16": (576, 1024),
        },
    },
}

DEFAULT_NEGATIVE = (
    "low quality, blurry, distorted anatomy, deformed hands, extra fingers, "
    "duplicate limbs, waxy skin, plastic skin"
)

VARIATION_STRENGTH = {
    "preserve": 0.48,
    "balanced": 0.70,
    "new-scene": 0.88,
}


class ReferenceImage(BaseModel):
    dataUrl: str
    title: str | None = None


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=6000)
    aspectRatio: Literal["1:1", "4:5", "3:2", "16:9", "9:16"] = "4:5"
    references: list[ReferenceImage] = Field(default_factory=list, max_length=4)
    profile: Literal["fast", "quality"] = "fast"
    negativePrompt: str | None = None
    steps: int | None = Field(default=None, ge=1, le=80)
    guidanceScale: float | None = Field(default=None, ge=0, le=30)
    strength: float | None = Field(default=None, ge=0, le=1)
    variationMode: Literal["preserve", "balanced", "new-scene"] = "balanced"
    seed: int | None = Field(default=None, ge=0, le=2147483647)


def clear_model():
    global loaded_profile, text_pipe, image_pipe

    image_pipe = None
    text_pipe = None
    loaded_profile = None
    gc.collect()

    if DEVICE == "mps" and hasattr(torch, "mps"):
        torch.mps.empty_cache()
    elif DEVICE == "cuda":
        torch.cuda.empty_cache()


def ensure_profile(profile: Literal["fast", "quality"]):
    global loaded_profile, text_pipe, image_pipe

    if loaded_profile == profile and text_pipe is not None and image_pipe is not None:
        return

    clear_model()
    config = PROFILE_CONFIG[profile]

    pipe = AutoPipelineForText2Image.from_pretrained(
        config["model"],
        dtype=DTYPE,
        use_safetensors=True,
    )
    pipe = pipe.to(DEVICE)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    img_pipe = AutoPipelineForImage2Image.from_pipe(pipe).to(DEVICE)
    if hasattr(img_pipe, "enable_attention_slicing"):
        img_pipe.enable_attention_slicing()
    if hasattr(img_pipe, "enable_vae_slicing"):
        img_pipe.enable_vae_slicing()
    if hasattr(img_pipe, "enable_vae_tiling"):
        img_pipe.enable_vae_tiling()

    text_pipe = pipe
    image_pipe = img_pipe
    loaded_profile = profile


def decode_data_url(value: str) -> Image.Image:
    if not value.startswith("data:image/") or "," not in value:
        raise ValueError("Reference must be an image data URL.")
    encoded = value.split(",", 1)[1]
    raw = base64.b64decode(encoded, validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def encode_png(image: Image.Image) -> str:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def compact_jpeg_data_url(value: str) -> str:
    image = decode_data_url(value)
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=91, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def fetch_reference(url: str, title: str | None = None) -> ReferenceImage:
    response = httpx.get(url, timeout=60.0, follow_redirects=True)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").split(";")[0]
    if not content_type.startswith("image/"):
        raise RuntimeError("Queued reference URL did not return an image.")
    if not response.content or len(response.content) > 12 * 1024 * 1024:
        raise RuntimeError("Queued reference image is empty or too large.")
    data_url = "data:" + content_type + ";base64," + base64.b64encode(response.content).decode("ascii")
    return ReferenceImage(dataUrl=data_url, title=title)


def run_generation(request: ImageRequest):
    started = time.time()
    config = PROFILE_CONFIG[request.profile]
    width, height = config["dimensions"][request.aspectRatio]

    steps = request.steps if request.steps is not None else config["steps"]
    guidance = request.guidanceScale if request.guidanceScale is not None else config["guidance"]
    strength = (
        request.strength
        if request.strength is not None
        else (
            VARIATION_STRENGTH[request.variationMode]
            if request.references
            else config["strength"]
        )
    )
    negative = request.negativePrompt or DEFAULT_NEGATIVE
    seed = (
        request.seed
        if request.seed is not None
        else int.from_bytes(os.urandom(4), "big") % 2147483648
    )
    generator = torch.Generator(device="cpu").manual_seed(seed)

    with MODEL_LOCK:
        ensure_profile(request.profile)

        common = dict(
            prompt=request.prompt,
            negative_prompt=negative,
            num_inference_steps=steps,
            guidance_scale=guidance,
        )

        if request.references:
            source = decode_data_url(request.references[0].dataUrl)
            source = source.resize((width, height), Image.Resampling.LANCZOS)
            result = image_pipe(
                image=source,
                strength=strength,
                generator=generator,
                **common,
            )
            references_used = 1
        else:
            result = text_pipe(
                width=width,
                height=height,
                generator=generator,
                **common,
            )
            references_used = 0

    if not result.images:
        raise RuntimeError("Model returned no image.")

    image = result.images[0].convert("RGB")
    extrema = image.getextrema()
    if all(channel_max <= 1 for _, channel_max in extrema):
        safety_flags = getattr(result, "nsfw_content_detected", None)
        if safety_flags and any(bool(flag) for flag in safety_flags):
            raise RuntimeError("Generation was blocked by the model safety checker.")
        raise RuntimeError(
            "Model produced an all-black image. The worker rejected the result instead of returning it."
        )

    return {
        "dataUrl": encode_png(image),
        "model": config["model"],
        "profile": request.profile,
        "provider": "cooperative-worker",
        "referencesUsed": references_used,
        "latencyMs": int((time.time() - started) * 1000),
        "seed": seed,
        "variationMode": request.variationMode,
    }


def queue_headers():
    if not WORKER_TOKEN:
        raise RuntimeError("INFERENCE_WORKER_TOKEN is required for async queue polling.")
    return {
        "Authorization": f"Bearer {WORKER_TOKEN}",
        "Content-Type": "application/json",
    }


def complete_job(job_id: str, payload: dict):
    response = httpx.post(
        f"{QUEUE_URL}/api/inference/jobs/complete",
        headers=queue_headers(),
        json={"jobId": job_id, **payload},
        timeout=120.0,
        follow_redirects=True,
    )
    response.raise_for_status()


def queue_loop():
    print(f"Async queue polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    while True:
        job_id = None
        try:
            response = httpx.post(
                f"{QUEUE_URL}/api/inference/jobs/claim",
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
            print(f"Claimed async image job {job_id} ({profile}).")

            references = [
                fetch_reference(item["url"], item.get("title"))
                for item in (job.get("references") or [])[:4]
                if isinstance(item, dict) and item.get("url")
            ]

            request = ImageRequest(
                prompt=job["prompt"],
                aspectRatio=job.get("aspectRatio", "4:5"),
                profile=profile,
                references=references,
                negativePrompt=job.get("negativePrompt"),
                steps=job.get("steps"),
                guidanceScale=job.get("guidanceScale"),
                strength=job.get("strength"),
                variationMode=job.get("variationMode", "balanced"),
                seed=job.get("seed"),
            )

            result = run_generation(request)
            result["dataUrl"] = compact_jpeg_data_url(result["dataUrl"])
            complete_job(job_id, result)
            print(f"Completed async image job {job_id}.")
        except Exception as exc:
            message = str(exc)[:1000]
            print(f"Async image queue error: {message}")
            if job_id:
                try:
                    complete_job(job_id, {"error": message})
                except Exception as completion_exc:
                    print(f"Could not report failure for {job_id}: {completion_exc}")
            time.sleep(QUEUE_POLL_SECONDS)


def require_worker_token(authorization: str | None):
    if not WORKER_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="INFERENCE_WORKER_TOKEN is required before image generation can be exposed.",
        )
    if authorization != f"Bearer {WORKER_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": DEVICE,
        "dtype": str(DTYPE).replace("torch.", ""),
        "loadedProfile": loaded_profile,
        "models": {
            "fast": FAST_MODEL_ID,
            "quality": QUALITY_MODEL_ID,
        },
        "huggingFaceAuthenticated": bool(os.getenv("HF_TOKEN")),
        "asyncQueue": {
            "configured": bool(QUEUE_URL and WORKER_TOKEN),
            "url": QUEUE_URL or None,
            "workerId": WORKER_ID,
        },
        "capabilities": [
            "image_generation",
            "image_to_image",
            "fast_profile",
            "quality_profile",
            "async_queue",
            "seeded_variation",
            "variation_modes",
        ],
    }


@app.get("/capabilities")
def capabilities():
    return {
        "provider": "cooperative-worker",
        "models": {
            "fast": FAST_MODEL_ID,
            "quality": QUALITY_MODEL_ID,
        },
        "capabilities": {
            "imageGeneration": True,
            "referenceImages": 1,
            "textGeneration": False,
            "profiles": ["fast", "quality"],
            "asyncQueue": bool(QUEUE_URL and WORKER_TOKEN),
            "variationModes": ["preserve", "balanced", "new-scene"],
            "seededVariation": True,
        },
    }


@app.post("/v1/images/generate")
def generate(request: ImageRequest, authorization: str | None = Header(default=None)):
    require_worker_token(authorization)
    try:
        return run_generation(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:800]) from exc


if __name__ == "__main__":
    if PRELOAD_PROFILE in {"fast", "quality"}:
        try:
            ensure_profile(PRELOAD_PROFILE)
        except Exception as exc:
            print(f"Preload of {PRELOAD_PROFILE} profile failed: {exc}")

    if QUEUE_URL and WORKER_TOKEN:
        threading.Thread(target=queue_loop, daemon=True, name="cooperative-queue").start()
    elif QUEUE_URL:
        print("COOPERATIVE_QUEUE_URL is set, but INFERENCE_WORKER_TOKEN is missing; queue polling disabled.")

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
