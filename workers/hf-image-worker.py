# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "accelerate>=1.2.0",
#   "diffusers>=0.35.0",
#   "fastapi>=0.115.0",
#   "pillow>=11.0.0",
#   "safetensors>=0.5.0",
#   "torch>=2.5.0",
#   "transformers>=4.47.0",
#   "uvicorn[standard]>=0.34.0",
# ]
# ///

import base64
import io
import os
import time
from typing import Literal

import torch
import uvicorn
from diffusers import StableDiffusionImg2ImgPipeline, StableDiffusionPipeline
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

MODEL_ID = os.getenv(
    "MODEL_ID",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32

app = FastAPI(title="CoOperative Temporary Image Worker", version="0.1.0")

text_pipe = StableDiffusionPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=DTYPE,
)
text_pipe = text_pipe.to(DEVICE)
image_pipe = StableDiffusionImg2ImgPipeline(**text_pipe.components)

if DEVICE == "cuda":
    text_pipe.enable_attention_slicing()
    image_pipe.enable_attention_slicing()


class ReferenceImage(BaseModel):
    dataUrl: str
    title: str | None = None


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=6000)
    aspectRatio: Literal["1:1", "4:5", "3:2", "16:9", "9:16"] = "4:5"
    references: list[ReferenceImage] = Field(default_factory=list, max_length=4)
    negativePrompt: str | None = None
    steps: int = Field(default=28, ge=1, le=80)
    guidanceScale: float = Field(default=7.0, ge=0, le=30)
    strength: float = Field(default=0.62, ge=0, le=1)


def dimensions(ratio: str) -> tuple[int, int]:
    return {
        "1:1": (512, 512),
        "4:5": (512, 640),
        "3:2": (768, 512),
        "16:9": (768, 432),
        "9:16": (432, 768),
    }[ratio]


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


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": DEVICE,
        "model": MODEL_ID,
        "capabilities": ["image_generation", "image_to_image"],
    }


@app.get("/capabilities")
def capabilities():
    return {
        "provider": "huggingface-job",
        "model": MODEL_ID,
        "capabilities": {
            "imageGeneration": True,
            "referenceImages": 1,
            "textGeneration": False,
        },
    }


@app.post("/v1/images/generate")
def generate(request: ImageRequest):
    started = time.time()
    width, height = dimensions(request.aspectRatio)

    common = dict(
        prompt=request.prompt,
        negative_prompt=request.negativePrompt,
        num_inference_steps=request.steps,
        guidance_scale=request.guidanceScale,
    )

    try:
        if request.references:
            source = decode_data_url(request.references[0].dataUrl)
            source = source.resize((width, height), Image.Resampling.LANCZOS)
            result = image_pipe(
                image=source,
                strength=request.strength,
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

        image = result.images[0]
        return {
            "dataUrl": encode_png(image),
            "model": MODEL_ID,
            "provider": "huggingface-job",
            "referencesUsed": references_used,
            "latencyMs": int((time.time() - started) * 1000),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:600]) from exc


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
