# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "accelerate>=1.2.0",
#   "diffusers>=0.35.0",
#   "fastapi>=0.115.0",
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
import threading
import time
from typing import Literal

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
PRELOAD_PROFILE = os.getenv("PRELOAD_PROFILE", "fast").lower()
if PRELOAD_PROFILE not in {"fast", "quality", "none"}:
    PRELOAD_PROFILE = "fast"

app = FastAPI(title="CoOperative AI Local Image Worker", version="0.3.0")

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
        "capabilities": ["image_generation", "image_to_image", "fast_profile", "quality_profile"],
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
        },
    }


@app.post("/v1/images/generate")
def generate(request: ImageRequest, authorization: str | None = Header(default=None)):
    require_worker_token(authorization)
    started = time.time()
    config = PROFILE_CONFIG[request.profile]
    width, height = config["dimensions"][request.aspectRatio]

    steps = request.steps if request.steps is not None else config["steps"]
    guidance = request.guidanceScale if request.guidanceScale is not None else config["guidance"]
    strength = request.strength if request.strength is not None else config["strength"]
    negative = request.negativePrompt or DEFAULT_NEGATIVE

    try:
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
                    **common,
                )
                references_used = 1
            else:
                result = text_pipe(
                    width=width,
                    height=height,
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
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:800]) from exc


if __name__ == "__main__":
    if PRELOAD_PROFILE in {"fast", "quality"}:
        try:
            ensure_profile(PRELOAD_PROFILE)
        except Exception as exc:
            print(f"Preload of {PRELOAD_PROFILE} profile failed: {exc}")
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
