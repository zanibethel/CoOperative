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
import platform
import socket
from pathlib import Path
import threading
import time
from typing import Literal

import httpx
import torch
import uvicorn
from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
from fastapi import FastAPI, Header, HTTPException
from transformers import CLIPVisionModelWithProjection
from PIL import Image
from pydantic import BaseModel, Field

from unison_runtime import node_available, start_heartbeat_thread

FAST_MODEL_ID = os.getenv(
    "FAST_MODEL_ID",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
)
QUALITY_MODEL_ID = os.getenv(
    "QUALITY_MODEL_ID",
    "segmind/SSD-1B",
)
IDENTITY_MODEL_ID = os.getenv(
    "IDENTITY_MODEL_ID",
    "stabilityai/stable-diffusion-xl-base-1.0",
)
IP_ADAPTER_MODEL_ID = os.getenv(
    "IP_ADAPTER_MODEL_ID",
    "h94/IP-Adapter",
)
IP_ADAPTER_WEIGHT = os.getenv(
    "IP_ADAPTER_WEIGHT",
    "ip-adapter-plus_sdxl_vit-h.safetensors",
)

if torch.cuda.is_available():
    DEVICE = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

DTYPE = torch.float16 if DEVICE in {"cuda", "mps"} else torch.float32
WORKER_TOKEN = os.getenv("UNISON_NODE_TOKEN") or os.getenv("INFERENCE_WORKER_TOKEN")
QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
QUEUE_POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_QUEUE_POLL_SECONDS", "3")))
WORKER_ID = (
    os.getenv("UNISON_NODE_ID")
    or os.getenv("COOPERATIVE_WORKER_ID")
    or socket.gethostname()
)[:160]
PRELOAD_PROFILE = os.getenv("PRELOAD_PROFILE", "fast").lower()
if PRELOAD_PROFILE not in {"fast", "quality", "none"}:
    PRELOAD_PROFILE = "fast"

app = FastAPI(title="CoOperative AI Local Image Worker", version="0.9.0")

MODEL_LOCK = threading.Lock()
UNISON_BUSY = threading.Event()
TEXT_READY_MARKER = Path(__file__).with_name("text-worker.ready")
TEXT_BUSY_MARKER = Path(__file__).with_name("text-worker.busy")
loaded_profile: str | None = None
text_pipe = None
image_pipe = None
identity_adapter_loaded = False

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
    global loaded_profile, text_pipe, image_pipe, identity_adapter_loaded

    image_pipe = None
    text_pipe = None
    loaded_profile = None
    identity_adapter_loaded = False
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

    # IP-Adapter reloads UNet attention processors. SlicedAttnProcessor requires
    # constructor state that the adapter loader does not preserve, so Local Quality
    # keeps the default SDPA attention processor when identity guidance is available.
    if profile != "quality" and hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    img_pipe = AutoPipelineForImage2Image.from_pipe(pipe).to(DEVICE)
    if profile != "quality" and hasattr(img_pipe, "enable_attention_slicing"):
        img_pipe.enable_attention_slicing()
    if hasattr(img_pipe, "enable_vae_slicing"):
        img_pipe.enable_vae_slicing()
    if hasattr(img_pipe, "enable_vae_tiling"):
        img_pipe.enable_vae_tiling()

    text_pipe = pipe
    image_pipe = img_pipe
    loaded_profile = profile


def ensure_identity_profile():
    global loaded_profile, text_pipe, image_pipe, identity_adapter_loaded

    if (
        loaded_profile == "quality-identity"
        and text_pipe is not None
        and identity_adapter_loaded
    ):
        return

    clear_model()
    print(f"Loading identity base model {IDENTITY_MODEL_ID}...", flush=True)

    image_encoder = CLIPVisionModelWithProjection.from_pretrained(
        IP_ADAPTER_MODEL_ID,
        subfolder="models/image_encoder",
        torch_dtype=DTYPE,
    )

    pipe = AutoPipelineForText2Image.from_pretrained(
        IDENTITY_MODEL_ID,
        image_encoder=image_encoder,
        torch_dtype=DTYPE,
        use_safetensors=True,
    ).to(DEVICE)

    print(
        f"Loading identity adapter {IP_ADAPTER_MODEL_ID}/{IP_ADAPTER_WEIGHT}...",
        flush=True,
    )
    pipe.load_ip_adapter(
        IP_ADAPTER_MODEL_ID,
        subfolder="sdxl_models",
        weight_name=IP_ADAPTER_WEIGHT,
    )

    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    text_pipe = pipe
    image_pipe = None
    loaded_profile = "quality-identity"
    identity_adapter_loaded = True
    print("SDXL identity pipeline loaded.", flush=True)


def identity_scale(variation_mode: str) -> float:
    if variation_mode == "new-scene":
        return 0.50
    return 0.68


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
        identity_generation = (
            bool(request.references)
            and request.profile == "quality"
            and request.variationMode != "preserve"
        )
        if identity_generation:
            ensure_identity_profile()
        else:
            ensure_profile(request.profile)

        common = dict(
            prompt=request.prompt,
            negative_prompt=negative,
            num_inference_steps=steps,
            guidance_scale=guidance,
        )

        if identity_generation:
            scale = identity_scale(request.variationMode)

            identity_images = [
                decode_data_url(reference.dataUrl)
                for reference in request.references[:2]
            ]
            if len(identity_images) == 1:
                text_pipe.set_ip_adapter_scale(scale)
                ip_adapter_image = identity_images[0]
            else:
                text_pipe.set_ip_adapter_scale(
                    [[scale for _ in identity_images]]
                )
                ip_adapter_image = [identity_images]

            result = text_pipe(
                width=width,
                height=height,
                ip_adapter_image=ip_adapter_image,
                generator=generator,
                **common,
            )
            references_used = len(identity_images)
            reference_mode = "ip-adapter"
        elif request.references:
            if identity_adapter_loaded and hasattr(image_pipe, "set_ip_adapter_scale"):
                image_pipe.set_ip_adapter_scale(0.0)
            source = decode_data_url(request.references[0].dataUrl)
            source = source.resize((width, height), Image.Resampling.LANCZOS)
            result = image_pipe(
                image=source,
                strength=strength,
                generator=generator,
                **common,
            )
            references_used = 1
            reference_mode = "img2img"
        else:
            if identity_adapter_loaded and hasattr(text_pipe, "set_ip_adapter_scale"):
                text_pipe.set_ip_adapter_scale(0.0)
            result = text_pipe(
                width=width,
                height=height,
                generator=generator,
                **common,
            )
            references_used = 0
            reference_mode = "none"

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
        "model": IDENTITY_MODEL_ID if identity_generation else config["model"],
        "profile": request.profile,
        "provider": "cooperative-worker",
        "referencesUsed": references_used,
        "latencyMs": int((time.time() - started) * 1000),
        "seed": seed,
        "variationMode": request.variationMode,
        "referenceMode": reference_mode,
    }


def queue_headers():
    if not WORKER_TOKEN:
        raise RuntimeError("A Unison node or inference worker token is required for async queue polling.")
    return {
        "Authorization": f"Bearer {WORKER_TOKEN}",
        "Content-Type": "application/json",
    }


def complete_job(job_id: str, payload: dict):
    response = httpx.post(
        f"{QUEUE_URL}/api/inference/jobs/complete",
        headers=queue_headers(),
        json={"jobId": job_id, "workerId": WORKER_ID, **payload},
        timeout=120.0,
        follow_redirects=True,
    )
    response.raise_for_status()


def queue_loop():
    print(f"Async queue polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    while True:
        job_id = None
        try:
            if not node_available():
                if loaded_profile is not None:
                    with MODEL_LOCK:
                        clear_model()
                    print("Unison node is in active use; released model memory.", flush=True)
                time.sleep(QUEUE_POLL_SECONDS)
                continue

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

            UNISON_BUSY.set()
            try:
                result = run_generation(request)
            finally:
                UNISON_BUSY.clear()

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
            detail="A Unison node or inference worker token is required before image generation can be exposed.",
        )
    if authorization != f"Bearer {WORKER_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def unison_capabilities():
    capabilities = [
        "image_generation",
        "image_to_image",
        "fast_profile",
        "quality_profile",
        "async_queue",
        "seeded_variation",
        "variation_modes",
        "ip_adapter_identity",
        "multi_reference_identity",
    ]
    if platform.system() == "Windows" and TEXT_READY_MARKER.exists():
        capabilities.extend(
            [
                "text_generation",
                "text_fast_profile",
                "text_quality_profile",
            ]
        )
    if platform.system() == "Windows" and os.getenv("UNISON_INSTALL_SCOPE", "").lower() == "machine":
        capabilities.extend(["machine_wide", "whole_pc_idle"])
    return capabilities


def unison_busy():
    return UNISON_BUSY.is_set() or TEXT_BUSY_MARKER.exists()


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
            "qualityIdentity": IDENTITY_MODEL_ID,
        },
        "huggingFaceAuthenticated": bool(os.getenv("HF_TOKEN")),
        "asyncQueue": {
            "configured": bool(QUEUE_URL and WORKER_TOKEN),
            "url": QUEUE_URL or None,
            "workerId": WORKER_ID,
        },
        "capabilities": unison_capabilities(),
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
            "referenceImages": 2,
            "textGeneration": platform.system() == "Windows" and TEXT_READY_MARKER.exists(),
            "profiles": ["fast", "quality"],
            "asyncQueue": bool(QUEUE_URL and WORKER_TOKEN),
            "variationModes": ["preserve", "balanced", "new-scene"],
            "seededVariation": True,
            "identityConditioning": "sdxl-ip-adapter-plus",
            "identityModel": IDENTITY_MODEL_ID,
            "multiReferenceIdentity": 2,
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
    start_heartbeat_thread(
        unison_capabilities(),
        (
            "windows-unison-1.0.0-machine"
            if platform.system() == "Windows" and os.getenv("UNISON_INSTALL_SCOPE", "").lower() == "machine"
            else "windows-unison-0.9.3"
            if platform.system() == "Windows"
            else "image-worker-0.9.0"
        ),
        busy_provider=unison_busy,
    )
    print("UNISON_RUNTIME_STARTED", flush=True)

    if PRELOAD_PROFILE in {"fast", "quality"}:
        try:
            ensure_profile(PRELOAD_PROFILE)
        except Exception as exc:
            print(f"Preload of {PRELOAD_PROFILE} profile failed: {exc}")

    if QUEUE_URL and WORKER_TOKEN:
        threading.Thread(target=queue_loop, daemon=True, name="cooperative-queue").start()
    elif QUEUE_URL:
        print("COOPERATIVE_QUEUE_URL is set, but no node/worker token is configured; queue polling disabled.")

    # Windows Unison workers use the outbound async queue, so they do not need a
    # fixed public listener. An ephemeral loopback port avoids collisions with a
    # stale/older worker during in-place upgrades.
    default_host = "127.0.0.1" if platform.system() == "Windows" else "0.0.0.0"
    default_port = "0" if platform.system() == "Windows" else "8000"
    uvicorn.run(
        app,
        host=os.getenv("WORKER_BIND_HOST", default_host),
        port=int(os.getenv("PORT", default_port)),
    )
