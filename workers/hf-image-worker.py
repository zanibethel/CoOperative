# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "accelerate>=1.2.0",
#   "diffusers>=0.35.0",
#   "fastapi>=0.115.0",
#   "httpx>=0.28.0",
#   "pillow>=11.0.0",
#   "peft>=0.13.1",
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
import re
import shutil
import socket
import subprocess
from pathlib import Path
import runpy
import threading
import time
from typing import Literal

import httpx
import torch
import uvicorn
from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
from fastapi import FastAPI, Header, HTTPException
from transformers import CLIPVisionModelWithProjection
from PIL import Image, ImageFilter, ImageStat
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
EXPLICIT_MODEL_ID = os.getenv(
    "EXPLICIT_MODEL_ID",
    "stablediffusionapi/duchaiten-real3d-nsfw-xl",
)
EXPLICIT_LORA_ID = os.getenv("EXPLICIT_LORA_ID", "").strip()
EXPLICIT_LORA_WEIGHT_NAME = os.getenv("EXPLICIT_LORA_WEIGHT_NAME", "").strip()
try:
    EXPLICIT_LORA_SCALE = float(os.getenv("EXPLICIT_LORA_SCALE", "0.8"))
except ValueError:
    EXPLICIT_LORA_SCALE = 0.8
EXPLICIT_LORA_SCALE = max(0.0, min(1.5, EXPLICIT_LORA_SCALE))
EXPLICIT_LORA_ADAPTER_NAME = os.getenv(
    "EXPLICIT_LORA_ADAPTER_NAME",
    "cooperative-explicit",
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

app = FastAPI(title="CoOperative AI Local Image Worker", version="0.11.2")

def start_repo_recovery_worker():
    enabled = os.getenv("COOPERATIVE_START_REPO_AGENT", "1").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        print("Local repo Recovery Agent auto-start disabled.", flush=True)
        return None

    script = Path(__file__).with_name("repo-agent-worker.py")
    if not script.exists():
        print("Local repo Recovery Agent script not found; background code repair unavailable.", flush=True)
        return None
    if not WORKER_TOKEN:
        print("Local repo Recovery Agent not started: worker token is unavailable.", flush=True)
        return None

    os.environ.setdefault("INFERENCE_WORKER_TOKEN", WORKER_TOKEN)
    os.environ.setdefault("COOPERATIVE_QUEUE_URL", QUEUE_URL)

    def runner():
        try:
            runpy.run_path(str(script), run_name="__main__")
        except Exception as exc:
            print(
                "Local repo Recovery Agent stopped: " + str(exc)[:800],
                flush=True,
            )

    thread = threading.Thread(
        target=runner,
        daemon=True,
        name="cooperative-repo-recovery",
    )
    thread.start()
    print("Local repo Recovery Agent polling started.", flush=True)
    return thread


def start_local_text_worker():
    enabled = os.getenv("COOPERATIVE_START_TEXT_WORKER", "1").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        print("Local MLX text worker auto-start disabled.", flush=True)
        return None
    if platform.system() != "Darwin" or platform.machine() not in {"arm64", "aarch64"}:
        return None

    script = Path(__file__).with_name("mlx-text-worker.py")
    if not script.exists():
        print("Local MLX text worker script not found; recovery reasoning will wait for another text node.", flush=True)
        return None

    uv = shutil.which("uv")
    if not uv:
        print("Local MLX text worker not started: uv is unavailable.", flush=True)
        return None

    env = os.environ.copy()
    env.setdefault("COOPERATIVE_QUEUE_URL", QUEUE_URL)
    # Child text/vision work is part of the same physical Unison node. Always
    # pass the canonical image-worker node id so targeted jobs cannot miss the
    # child worker because macOS hostname aliases differ.
    env.setdefault("UNISON_NODE_ID", WORKER_ID)
    if "UNISON_NODE_TOKEN" not in env and "INFERENCE_WORKER_TOKEN" not in env and WORKER_TOKEN:
        env["INFERENCE_WORKER_TOKEN"] = WORKER_TOKEN

    try:
        process = subprocess.Popen(
            [uv, "run", str(script)],
            cwd=str(Path(__file__).resolve().parent.parent),
            env=env,
        )
    except Exception as exc:
        print("Local MLX text worker could not start: " + str(exc)[:800], flush=True)
        return None

    print(f"Local MLX text worker started (pid {process.pid}).", flush=True)
    return process


MODEL_LOCK = threading.Lock()
UNISON_BUSY = threading.Event()
TEXT_READY_MARKER = Path(__file__).with_name("text-worker.ready")
TEXT_BUSY_MARKER = Path(__file__).with_name("text-worker.busy")
LOCAL_CHAT_READY_MARKER = Path(__file__).with_name("local-chat.ready")
LOCAL_CHAT_BUSY_MARKER = Path(__file__).with_name("local-chat.busy")
IMAGE_PORT_MARKER = Path(__file__).with_name("image-worker.port")
IMAGE_BUSY_MARKER = Path(__file__).with_name("image-worker.busy")
IMAGE_PORT_MARKER.unlink(missing_ok=True)
IMAGE_BUSY_MARKER.unlink(missing_ok=True)
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
    contentMode: Literal["sfw", "adult_non_explicit", "adult_explicit"] = "sfw"
    negativePrompt: str | None = None
    steps: int | None = Field(default=None, ge=1, le=80)
    guidanceScale: float | None = Field(default=None, ge=0, le=30)
    strength: float | None = Field(default=None, ge=0, le=1)
    variationMode: Literal["preserve", "balanced", "new-scene"] = "balanced"
    seed: int | None = Field(default=None, ge=0, le=2147483647)
    pipelineMode: Literal["single-pass", "quality-v1"] = "single-pass"


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



def ensure_explicit_profile():
    global loaded_profile, text_pipe, image_pipe, identity_adapter_loaded

    expected_profile = (
        "explicit-owned-model-lora"
        if EXPLICIT_LORA_ID
        else "explicit-owned-model"
    )
    if (
        loaded_profile == expected_profile
        and text_pipe is not None
        and image_pipe is not None
    ):
        return

    clear_model()
    print(f"Loading owned explicit-capable model {EXPLICIT_MODEL_ID}...", flush=True)

    pipe = AutoPipelineForText2Image.from_pretrained(
        EXPLICIT_MODEL_ID,
        dtype=DTYPE,
        use_safetensors=True,
    ).to(DEVICE)

    if EXPLICIT_LORA_ID:
        print(
            f"Loading optional explicit adapter {EXPLICIT_LORA_ID} "
            f"at scale {EXPLICIT_LORA_SCALE:.2f}...",
            flush=True,
        )
        lora_kwargs = {"adapter_name": EXPLICIT_LORA_ADAPTER_NAME}
        if EXPLICIT_LORA_WEIGHT_NAME:
            lora_kwargs["weight_name"] = EXPLICIT_LORA_WEIGHT_NAME
        pipe.load_lora_weights(EXPLICIT_LORA_ID, **lora_kwargs)
        if not hasattr(pipe, "set_adapters"):
            raise RuntimeError(
                "The installed Diffusers pipeline cannot set LoRA adapter strength."
            )
        pipe.set_adapters(
            EXPLICIT_LORA_ADAPTER_NAME,
            adapter_weights=EXPLICIT_LORA_SCALE,
        )

    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    img_pipe = AutoPipelineForImage2Image.from_pipe(pipe).to(DEVICE)
    if hasattr(img_pipe, "enable_vae_slicing"):
        img_pipe.enable_vae_slicing()
    if hasattr(img_pipe, "enable_vae_tiling"):
        img_pipe.enable_vae_tiling()

    text_pipe = pipe
    image_pipe = img_pipe
    loaded_profile = expected_profile
    identity_adapter_loaded = False
    if EXPLICIT_LORA_ID:
        print(
            "Owned explicit checkpoint loaded with optional LoRA "
            f"{EXPLICIT_LORA_ID} at scale {EXPLICIT_LORA_SCALE:.2f}.",
            flush=True,
        )
    else:
        print(
            "Owned explicit checkpoint loaded without a separate LoRA adapter.",
            flush=True,
        )


def _term_is_explicitly_excluded(text: str, term: str) -> bool:
    """
    Treat ordinary safety exclusions like "no minors" or
    "without non-consensual content" as exclusions rather than positive intent.
    If the clause contains an exception/reversal, fail closed.
    """
    for match in re.finditer(re.escape(term), text):
        prefix = text[max(0, match.start() - 140):match.start()]
        clause = re.split(r"[.!?;\n]", prefix)[-1]
        has_exclusion = re.search(
            r"\b(?:no|without|exclude(?:d|s|ing)?|do not include|does not include|"
            r"not involving|does not involve|no depictions? of)\b",
            clause,
        )
        reverses_exclusion = re.search(
            r"\b(?:except|unless|but|including|include|with)\b",
            clause,
        )
        if has_exclusion and not reverses_exclusion:
            return True
    return False


def _contains_positive_unsafe_term(text: str, terms: tuple[str, ...]) -> bool:
    for term in terms:
        if term not in text:
            continue
        if not _term_is_explicitly_excluded(text, term):
            return True
    return False


def validate_content_mode(request: ImageRequest):
    if request.contentMode != "adult_explicit":
        return

    if request.references:
        raise RuntimeError(
            "Explicit adult local generation does not accept reference images or identity-preservation inputs."
        )

    text = request.prompt.lower()
    minor_terms = (
        "minor", "child", "kid", "underage", "teen", "schoolgirl",
        "schoolboy", "young-looking", "preteen", "pre-teen"
    )
    coercion_terms = (
        "rape", "raped", "forced sex", "nonconsensual", "non-consensual",
        "against their will", "unconscious sex", "drugged sex"
    )
    if _contains_positive_unsafe_term(text, minor_terms):
        raise RuntimeError(
            "Explicit adult local generation was blocked because the prompt contains positive minor-age language."
        )
    if _contains_positive_unsafe_term(text, coercion_terms):
        raise RuntimeError(
            "Explicit adult local generation was blocked because the prompt contains positive coercive or non-consensual sexual content."
        )

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


HUMAN_DETAIL_TERMS = (
    "person", "people", "woman", "women", "man", "men", "adult", "couple",
    "portrait", "face", "body", "human", "girl", "boy"
)


def local_quality_report(image: Image.Image, prompt: str):
    """
    Fast local image-signal judge.

    This intentionally does not pretend to semantically understand anatomy.
    It measures image detail/contrast/resolution and uses prompt intent only to
    prioritize a human-detail refinement pass when the request contains people.
    """
    gray = image.convert("L")
    gray_stats = ImageStat.Stat(gray)
    contrast = float(gray_stats.stddev[0]) if gray_stats.stddev else 0.0
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edge_stats = ImageStat.Stat(edges)
    edge_mean = float(edge_stats.mean[0]) if edge_stats.mean else 0.0
    edge_std = float(edge_stats.stddev[0]) if edge_stats.stddev else 0.0
    prompt_lower = prompt.lower()
    human_detail_priority = any(term in prompt_lower for term in HUMAN_DETAIL_TERMS)

    sharpness_score = max(0.0, min(100.0, edge_std * 2.2))
    contrast_score = max(0.0, min(100.0, contrast * 1.7))
    min_dimension = min(image.size)
    resolution_score = max(
        0.0,
        min(100.0, ((min_dimension - 384.0) / (1024.0 - 384.0)) * 100.0),
    )

    reasons = []
    if sharpness_score < 52:
        reasons.append("soft-detail")
    if contrast_score < 42:
        reasons.append("low-local-contrast")
    if human_detail_priority:
        reasons.append("human-detail-priority")

    score = (
        sharpness_score * 0.50
        + contrast_score * 0.25
        + resolution_score * 0.25
    )

    return {
        "judge": "heuristic-local-quality-judge-v1",
        "score": round(score, 1),
        "sharpnessScore": round(sharpness_score, 1),
        "contrastScore": round(contrast_score, 1),
        "resolutionScore": round(resolution_score, 1),
        "width": image.width,
        "height": image.height,
        "humanDetailPriority": human_detail_priority,
        "reasons": reasons,
        "semanticAnatomyAssessment": False,
    }


def refinement_prompt(prompt: str, human_detail_priority: bool):
    if human_detail_priority:
        priorities = (
            "Refinement priorities: preserve the existing composition and pose; "
            "increase facial fidelity, anatomically coherent hands and limbs, "
            "natural skin texture, realistic proportions, fine photographic detail, "
            "and consistent lighting."
        )
    else:
        priorities = (
            "Refinement priorities: preserve the existing composition; increase "
            "fine texture detail, crisp natural edges, coherent materials, depth, "
            "and consistent lighting."
        )
    return prompt.rstrip() + "\n" + priorities


def run_quality_pipeline(
    request: ImageRequest,
    image: Image.Image,
    negative: str,
    model_used: str,
    seed: int,
):
    before = local_quality_report(image, request.prompt)
    trace = {
        "version": "quality-v1",
        "portableArtifactHandoff": "image",
        "stages": [
            {
                "stage": "quality-judge",
                "component": before["judge"],
                "score": before["score"],
                "metrics": before,
            }
        ],
    }

    should_refine = (
        request.profile == "quality"
        and not request.references
        and (
            before["sharpnessScore"] < 52
            or before["contrastScore"] < 42
            or before["humanDetailPriority"]
        )
    )

    refined = image
    if should_refine:
        refine_started = time.time()
        refine_steps = max(8, min(14, (request.steps or PROFILE_CONFIG["quality"]["steps"]) // 2))
        refine_strength = 0.22 if before["humanDetailPriority"] else 0.18
        refine_guidance = min(
            8.0,
            max(
                5.5,
                request.guidanceScale
                if request.guidanceScale is not None
                else PROFILE_CONFIG["quality"]["guidance"],
            ),
        )
        refine_seed = (seed + 1) % 2147483648

        try:
            with MODEL_LOCK:
                if request.contentMode == "adult_explicit":
                    ensure_explicit_profile()
                else:
                    ensure_profile("quality")

                refine_result = image_pipe(
                    prompt=refinement_prompt(
                        request.prompt,
                        bool(before["humanDetailPriority"]),
                    ),
                    negative_prompt=negative,
                    image=image,
                    strength=refine_strength,
                    num_inference_steps=refine_steps,
                    guidance_scale=refine_guidance,
                    generator=torch.Generator(device="cpu").manual_seed(refine_seed),
                )

            if refine_result.images:
                refined = refine_result.images[0].convert("RGB")
                after_refine = local_quality_report(refined, request.prompt)
                trace["stages"].append(
                    {
                        "stage": "targeted-refinement",
                        "component": model_used,
                        "applied": True,
                        "promptDrivenTargets": (
                            ["face-detail", "anatomy", "hands", "skin-texture", "lighting"]
                            if before["humanDetailPriority"]
                            else ["fine-detail", "texture", "lighting"]
                        ),
                        "semanticRegionDetection": False,
                        "strength": refine_strength,
                        "steps": refine_steps,
                        "seed": refine_seed,
                        "latencyMs": int((time.time() - refine_started) * 1000),
                        "postRefinementJudge": after_refine,
                    }
                )
            else:
                trace["stages"].append(
                    {
                        "stage": "targeted-refinement",
                        "component": model_used,
                        "applied": False,
                        "reason": "refinement-model-returned-no-image",
                    }
                )
        except Exception as exc:
            trace["stages"].append(
                {
                    "stage": "targeted-refinement",
                    "component": model_used,
                    "applied": False,
                    "reason": "refinement-failed",
                    "detail": str(exc)[:500],
                }
            )
    else:
        trace["stages"].append(
            {
                "stage": "targeted-refinement",
                "component": model_used,
                "applied": False,
                "reason": "judge-did-not-request-refinement",
            }
        )

    upscale_started = time.time()
    max_dimension = max(refined.size)
    upscale_scale = min(1.5, 2048 / max_dimension) if max_dimension > 0 else 1.0
    upscale_scale = max(1.0, upscale_scale)
    if upscale_scale > 1.001:
        target_size = (
            max(1, round(refined.width * upscale_scale)),
            max(1, round(refined.height * upscale_scale)),
        )
        refined = refined.resize(target_size, Image.Resampling.LANCZOS)
        upscale_applied = True
    else:
        target_size = refined.size
        upscale_applied = False

    trace["stages"].append(
        {
            "stage": "upscale",
            "component": "pillow-lanczos-v1",
            "applied": upscale_applied,
            "scale": round(upscale_scale, 3),
            "width": target_size[0],
            "height": target_size[1],
            "latencyMs": int((time.time() - upscale_started) * 1000),
            "note": "Deterministic local resampling; a learned super-resolution specialist can replace this component later.",
        }
    )
    trace["finalJudge"] = local_quality_report(refined, request.prompt)
    return refined, trace


def run_generation(request: ImageRequest):
    started = time.time()
    base_started = time.time()
    validate_content_mode(request)
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
    if request.contentMode == "sfw":
        negative = (
            negative
            + ", nudity, nude body, explicit sexual content, genitals, pornographic content"
        )
    seed = (
        request.seed
        if request.seed is not None
        else int.from_bytes(os.urandom(4), "big") % 2147483648
    )
    def seeded_generator():
        return torch.Generator(device="cpu").manual_seed(seed)

    with MODEL_LOCK:
        explicit_generation = request.contentMode == "adult_explicit"
        identity_generation = (
            bool(request.references)
            and request.profile == "quality"
            and request.variationMode != "preserve"
            and not explicit_generation
        )

        common = dict(
            prompt=request.prompt,
            negative_prompt=negative,
            num_inference_steps=steps,
            guidance_scale=guidance,
        )

        model_used = config["model"]

        if explicit_generation:
            ensure_explicit_profile()
            result = text_pipe(
                width=width,
                height=height,
                generator=seeded_generator(),
                **common,
            )
            references_used = 0
            reference_mode = "none"
            model_used = EXPLICIT_MODEL_ID
            print(
                "Local image path: owned explicit checkpoint text-to-image succeeded.",
                flush=True,
            )
        elif identity_generation:
            # Stability first: use one identity reference until multi-reference
            # IP-Adapter support is proven reliable on every local runtime.
            identity_image = decode_data_url(request.references[0].dataUrl)
            scale = identity_scale(request.variationMode)

            try:
                ensure_identity_profile()
                text_pipe.set_ip_adapter_scale(scale)
                result = text_pipe(
                    width=width,
                    height=height,
                    ip_adapter_image=identity_image,
                    generator=seeded_generator(),
                    **common,
                )
                references_used = 1
                reference_mode = "ip-adapter"
                model_used = IDENTITY_MODEL_ID
                print("Local image path: single-reference IP-Adapter succeeded.", flush=True)
            except Exception as identity_error:
                print(
                    "Local image identity path failed; falling back to quality img2img: "
                    + str(identity_error)[:800],
                    flush=True,
                )
                try:
                    ensure_profile(request.profile)
                    source = identity_image.resize((width, height), Image.Resampling.LANCZOS)
                    result = image_pipe(
                        image=source,
                        strength=strength,
                        generator=seeded_generator(),
                        **common,
                    )
                    references_used = 1
                    reference_mode = "img2img"
                    model_used = config["model"]
                    print("Local image path: img2img fallback succeeded.", flush=True)
                except Exception as img2img_error:
                    print(
                        "Local image img2img fallback failed; using text-to-image fallback: "
                        + str(img2img_error)[:800],
                        flush=True,
                    )
                    ensure_profile(request.profile)
                    result = text_pipe(
                        width=width,
                        height=height,
                        generator=seeded_generator(),
                        **common,
                    )
                    references_used = 0
                    reference_mode = "none"
                    model_used = config["model"]
                    print("Local image path: text-to-image fallback succeeded.", flush=True)
        else:
            ensure_profile(request.profile)
            if request.references:
                source = decode_data_url(request.references[0].dataUrl)
                source = source.resize((width, height), Image.Resampling.LANCZOS)
                result = image_pipe(
                    image=source,
                    strength=strength,
                    generator=seeded_generator(),
                    **common,
                )
                references_used = 1
                reference_mode = "img2img"
            else:
                result = text_pipe(
                    width=width,
                    height=height,
                    generator=seeded_generator(),
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

    base_latency_ms = int((time.time() - base_started) * 1000)
    pipeline_trace = {
        "version": "single-pass",
        "portableArtifactHandoff": "image",
        "stages": [
            {
                "stage": "base-generation",
                "component": model_used,
                "latencyMs": base_latency_ms,
                "width": image.width,
                "height": image.height,
            }
        ],
    }

    if request.pipelineMode == "quality-v1":
        image, quality_trace = run_quality_pipeline(
            request,
            image,
            negative,
            model_used,
            seed,
        )
        quality_trace["stages"].insert(
            0,
            {
                "stage": "base-generation",
                "component": model_used,
                "latencyMs": base_latency_ms,
                "width": result.images[0].width,
                "height": result.images[0].height,
            },
        )
        pipeline_trace = quality_trace

    return {
        "dataUrl": encode_png(image),
        "model": model_used,
        "profile": request.profile,
        "provider": "cooperative-worker",
        "referencesUsed": references_used,
        "latencyMs": int((time.time() - started) * 1000),
        "seed": seed,
        "variationMode": request.variationMode,
        "referenceMode": reference_mode,
        "contentMode": request.contentMode,
        "pipelineMode": request.pipelineMode,
        "pipelineTrace": pipeline_trace,
        "explicitLora": (
            {
                "id": EXPLICIT_LORA_ID,
                "weightName": EXPLICIT_LORA_WEIGHT_NAME or None,
                "scale": EXPLICIT_LORA_SCALE,
                "adapterName": EXPLICIT_LORA_ADAPTER_NAME,
            }
            if request.contentMode == "adult_explicit" and EXPLICIT_LORA_ID
            else None
        ),
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
            if not node_available() or TEXT_BUSY_MARKER.exists():
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
                contentMode=job.get("contentMode", "sfw"),
                references=references,
                negativePrompt=job.get("negativePrompt"),
                steps=job.get("steps"),
                guidanceScale=job.get("guidanceScale"),
                strength=job.get("strength"),
                variationMode=job.get("variationMode", "balanced"),
                seed=job.get("seed"),
                pipelineMode=job.get("pipelineMode", "single-pass"),
            )

            UNISON_BUSY.set()
            IMAGE_BUSY_MARKER.write_text(job_id, encoding="utf-8")
            try:
                result = run_generation(request)
            finally:
                IMAGE_BUSY_MARKER.unlink(missing_ok=True)
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
        "single_reference_identity",
        "owned_content_mode",
        "adult_explicit_text_to_image",
        "adult_explicit_owned_checkpoint",
        "composable_media_pipeline_v1",
        "local_quality_judge_v1",
        "targeted_refinement_v1",
        "local_lanczos_upscale_v1",
    ]
    if platform.system() == "Windows" and TEXT_READY_MARKER.exists():
        capabilities.extend(
            [
                "text_generation",
                "text_fast_profile",
                "text_quality_profile",
            ]
        )

    mac_text_enabled = os.getenv("COOPERATIVE_START_TEXT_WORKER", "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if (
        platform.system() == "Darwin"
        and platform.machine() in {"arm64", "aarch64"}
        and mac_text_enabled
        and Path(__file__).with_name("mlx-text-worker.py").exists()
    ):
        capabilities.append("semantic_media_judge_v1")
    if platform.system() == "Windows" and os.getenv("UNISON_INSTALL_SCOPE", "").lower() == "machine":
        capabilities.extend(["machine_wide", "whole_pc_idle"])
    if platform.system() == "Windows" and LOCAL_CHAT_READY_MARKER.exists():
        capabilities.extend(
            [
                "local_personal_chat",
                "local_ai_auto_model",
                "local_ai_images",
                "local_ai_image_generation",
                "local_ai_files",
                "local_ai_web_search",
                "local_ai_voice",
                "local_ai_history",
                "local_ai_projects",
            ]
        )
    recovery_active = os.getenv("COOPERATIVE_RECOVERY_AGENT_ACTIVE", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    embedded_recovery = (
        os.getenv("COOPERATIVE_START_REPO_AGENT", "1").strip().lower()
        in {"1", "true", "yes", "on"}
        and Path(__file__).with_name("repo-agent-worker.py").exists()
        and bool(WORKER_TOKEN)
    )
    if recovery_active or embedded_recovery:
        capabilities.append("recovery_agent")

    return capabilities


def unison_busy():
    return (
        UNISON_BUSY.is_set()
        or TEXT_BUSY_MARKER.exists()
        or LOCAL_CHAT_BUSY_MARKER.exists()
    )


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
            "explicitBase": EXPLICIT_MODEL_ID,
            "explicitLora": EXPLICIT_LORA_ID or None,
            "explicitLoraWeightName": EXPLICIT_LORA_WEIGHT_NAME or None,
            "explicitLoraScale": EXPLICIT_LORA_SCALE if EXPLICIT_LORA_ID else None,
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
            "explicitBase": EXPLICIT_MODEL_ID,
            "explicitLora": EXPLICIT_LORA_ID or None,
            "explicitLoraWeightName": EXPLICIT_LORA_WEIGHT_NAME or None,
            "explicitLoraScale": EXPLICIT_LORA_SCALE if EXPLICIT_LORA_ID else None,
        },
        "capabilities": {
            "imageGeneration": True,
            "referenceImages": 1,
            "textGeneration": platform.system() == "Windows" and TEXT_READY_MARKER.exists(),
            "profiles": ["fast", "quality"],
            "asyncQueue": bool(QUEUE_URL and WORKER_TOKEN),
            "variationModes": ["preserve", "balanced", "new-scene"],
            "seededVariation": True,
            "identityConditioning": "sdxl-ip-adapter-plus",
            "identityModel": IDENTITY_MODEL_ID,
            "explicitBaseModel": EXPLICIT_MODEL_ID,
            "explicitLora": EXPLICIT_LORA_ID,
            "explicitLoraScale": EXPLICIT_LORA_SCALE,
            "multiReferenceIdentity": 0,
            "composableMediaPipeline": ["quality-v1"],
            "qualityJudge": "heuristic-local-quality-judge-v1",
            "refinement": "same-model-low-strength-img2img",
            "upscaler": "pillow-lanczos-v1",
        },
    }


@app.post("/v1/images/generate")
def generate(request: ImageRequest, authorization: str | None = Header(default=None)):
    require_worker_token(authorization)
    UNISON_BUSY.set()
    try:
        return run_generation(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:800]) from exc
    finally:
        UNISON_BUSY.clear()


if __name__ == "__main__":
    start_heartbeat_thread(
        unison_capabilities(),
        (
            "windows-unison-1.0.0-machine"
            if platform.system() == "Windows" and os.getenv("UNISON_INSTALL_SCOPE", "").lower() == "machine"
            else "windows-unison-0.9.3"
            if platform.system() == "Windows"
            else "image-worker-0.11.2"
        ),
        busy_provider=unison_busy,
    )
    print("UNISON_RUNTIME_STARTED", flush=True)
    start_repo_recovery_worker()
    start_local_text_worker()

    if PRELOAD_PROFILE in {"fast", "quality"}:
        try:
            ensure_profile(PRELOAD_PROFILE)
        except Exception as exc:
            print(f"Preload of {PRELOAD_PROFILE} profile failed: {exc}")

    if QUEUE_URL and WORKER_TOKEN:
        threading.Thread(target=queue_loop, daemon=True, name="cooperative-queue").start()
    elif QUEUE_URL:
        print("COOPERATIVE_QUEUE_URL is set, but no node/worker token is configured; queue polling disabled.")

    # Windows uses a discoverable ephemeral loopback port. Personal Local AI
    # reads the marker and proxies image requests directly to this worker without
    # exposing the node token or sending the prompt through the CoOperative queue.
    default_host = "127.0.0.1" if platform.system() == "Windows" else "0.0.0.0"
    requested_port = int(os.getenv("PORT", "0" if platform.system() == "Windows" else "8000"))
    listener_port = requested_port
    if platform.system() == "Windows" and listener_port == 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            listener_port = int(probe.getsockname()[1])

    if platform.system() == "Windows":
        IMAGE_PORT_MARKER.write_text(str(listener_port), encoding="utf-8")

    try:
        uvicorn.run(
            app,
            host=os.getenv("WORKER_BIND_HOST", default_host),
            port=listener_port,
        )
    finally:
        if platform.system() == "Windows":
            IMAGE_PORT_MARKER.unlink(missing_ok=True)
