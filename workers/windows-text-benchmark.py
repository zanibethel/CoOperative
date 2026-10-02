# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
# ]
# ///

"""Benchmark and finalize the Windows Ollama model plan.

This runs during installation after Ollama is available. It measures actual
generation throughput and Ollama-reported VRAM residency for the provisional
Fast and Quality models. The plan is then rewritten with the best sustainable
profile choices for this PC.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
PLAN_PATH = HERE / "text-model-plan.json"
SUITE_PATH = HERE / "text-benchmark-suite.json"
OLLAMA_URL = os.getenv("UNISON_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
BENCHMARK_REVISION = "2026-10-02.1"
FALLBACK_MODEL = "qwen2.5:1.5b"


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def ollama_executable() -> str | None:
    configured = os.getenv("UNISON_OLLAMA_EXE")
    if configured and Path(configured).is_file():
        return configured

    direct = shutil.which("ollama")
    if direct:
        return direct

    candidates = [
        HERE / "runtime" / "ollama" / "ollama.exe",
        Path(os.getenv("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path(os.getenv("PROGRAMFILES", "")) / "Ollama" / "ollama.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    bundled = HERE / "runtime" / "ollama"
    if bundled.is_dir():
        matches = list(bundled.rglob("ollama.exe"))
        if matches:
            return str(matches[0])
    return None


def ollama_ready() -> bool:
    try:
        return httpx.get(f"{OLLAMA_URL}/api/version", timeout=2.5).is_success
    except Exception:
        return False


def ensure_ollama_server() -> subprocess.Popen | None:
    if ollama_ready():
        return None

    executable = ollama_executable()
    if not executable:
        raise RuntimeError("Ollama executable was not found for benchmarking.")

    log_path = HERE / "ollama-benchmark.log"
    log_file = log_path.open("a", encoding="utf-8")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [executable, "serve"],
        stdout=log_file,
        stderr=log_file,
        creationflags=creationflags,
        env=os.environ.copy(),
    )

    deadline = time.time() + 45
    while time.time() < deadline:
        if ollama_ready():
            return process
        if process.poll() is not None:
            break
        time.sleep(1)

    raise RuntimeError("Ollama did not become ready for the Windows benchmark.")


def pull_model(model: str) -> None:
    response = httpx.post(
        f"{OLLAMA_URL}/api/pull",
        json={"name": model, "stream": False},
        timeout=None,
    )
    response.raise_for_status()


def running_model_metrics(model: str) -> tuple[int, int]:
    try:
        response = httpx.get(f"{OLLAMA_URL}/api/ps", timeout=10)
        response.raise_for_status()
        models = response.json().get("models", [])
        for item in models:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("model") or "")
            if name == model or name.startswith(f"{model}:") or model.startswith(f"{name}:"):
                return int(item.get("size") or 0), int(item.get("size_vram") or 0)
    except Exception:
        pass
    return 0, 0


def benchmark_model(model: str, target_profiles: list[str], output_tokens: int) -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    result = {
        "model": model,
        "targetProfiles": target_profiles,
        "provider": "ollama-windows",
        "success": False,
        "promptTokens": 0,
        "outputTokens": 0,
        "latencyMs": 0,
        "loadDurationMs": 0,
        "promptEvalDurationMs": 0,
        "evalDurationMs": 0,
        "tokensPerSecond": None,
        "modelSizeBytes": 0,
        "vramBytes": 0,
        "gpuOffloadRatio": 0.0,
        "recordedAt": started_at,
        "error": None,
    }

    try:
        print(f"Preparing benchmark model {model}...", flush=True)
        pull_model(model)

        # A tiny warm-up separates model download/startup from the measured run.
        warm = httpx.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Reply with the word ready."}],
                "stream": False,
                "keep_alive": "10m",
                "options": {"num_predict": 8, "temperature": 0},
            },
            timeout=None,
        )
        warm.raise_for_status()

        started = time.perf_counter()
        response = httpx.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a concise assistant. Follow the requested format.",
                    },
                    {
                        "role": "user",
                        "content": (
                            "In four short bullet points, explain why measuring real "
                            "inference speed is better than guessing performance from hardware."
                        ),
                    },
                ],
                "stream": False,
                "keep_alive": "10m",
                "options": {
                    "num_predict": max(48, min(160, output_tokens)),
                    "temperature": 0,
                    "top_p": 0.9,
                },
            },
            timeout=None,
        )
        response.raise_for_status()
        body = response.json()
        latency_ms = int((time.perf_counter() - started) * 1000)
        output_count = int(body.get("eval_count") or 0)
        eval_duration_ns = int(body.get("eval_duration") or 0)
        model_size, vram_bytes = running_model_metrics(model)

        tps = (
            output_count / (eval_duration_ns / 1_000_000_000)
            if output_count > 0 and eval_duration_ns > 0
            else None
        )
        offload = (
            min(1.0, max(0.0, vram_bytes / model_size))
            if model_size > 0 and vram_bytes > 0
            else 0.0
        )

        result.update(
            {
                "success": True,
                "promptTokens": int(body.get("prompt_eval_count") or 0),
                "outputTokens": output_count,
                "latencyMs": latency_ms,
                "loadDurationMs": int(int(body.get("load_duration") or 0) / 1_000_000),
                "promptEvalDurationMs": int(
                    int(body.get("prompt_eval_duration") or 0) / 1_000_000
                ),
                "evalDurationMs": int(eval_duration_ns / 1_000_000),
                "tokensPerSecond": round(tps, 2) if tps else None,
                "modelSizeBytes": model_size,
                "vramBytes": vram_bytes,
                "gpuOffloadRatio": round(offload, 4),
            }
        )
        print(
            f"Benchmark {model}: {result['tokensPerSecond']} tok/s, "
            f"{result['latencyMs']} ms, {result['gpuOffloadRatio']:.0%} GPU resident.",
            flush=True,
        )
    except Exception as exc:
        result["error"] = str(exc)[:600]
        print(f"Benchmark {model} failed: {result['error']}", flush=True)

    return result


def result_for(results: list[dict], model: str) -> dict | None:
    for result in results:
        if result.get("model") == model:
            return result
    return None


def passes(
    result: dict | None,
    *,
    min_tps: float,
    min_offload: float,
    gpu_expected: bool,
) -> bool:
    if not result or result.get("success") is not True:
        return False
    tps = result.get("tokensPerSecond")
    if not isinstance(tps, (int, float)) or tps < min_tps:
        return False
    if gpu_expected:
        offload = result.get("gpuOffloadRatio")
        if not isinstance(offload, (int, float)) or offload < min_offload:
            return False
    return True


def main() -> None:
    plan = read_json(PLAN_PATH)
    if not plan:
        raise RuntimeError("text-model-plan.json is missing; run windows-model-plan.py first.")

    server_process = ensure_ollama_server()
    models = plan.get("models") if isinstance(plan.get("models"), dict) else {}
    policy = plan.get("benchmarkPolicy") if isinstance(plan.get("benchmarkPolicy"), dict) else {}
    acceleration = plan.get("acceleration") if isinstance(plan.get("acceleration"), dict) else {}

    fast_model = str(models.get("fast") or FALLBACK_MODEL)
    quality_model = str(models.get("quality") or fast_model)
    output_tokens = int(policy.get("benchmarkOutputTokens") or 96)
    min_fast = float(policy.get("fastMinTokensPerSecond") or 7.0)
    min_quality = float(policy.get("qualityMinTokensPerSecond") or 3.5)
    min_offload = float(policy.get("minimumGpuOffloadRatio") or 0.0)
    gpu_expected = int(acceleration.get("gpuMemoryTotalMb") or 0) > 0

    targets: dict[str, list[str]] = {}
    targets.setdefault(fast_model, []).append("fast")
    targets.setdefault(quality_model, []).append("quality")

    results: list[dict] = []
    for model, profiles in targets.items():
        results.append(benchmark_model(model, profiles, output_tokens))

    fast_result = result_for(results, fast_model)
    if not passes(
        fast_result,
        min_tps=min_fast,
        min_offload=min_offload,
        gpu_expected=gpu_expected,
    ) and fast_model != FALLBACK_MODEL:
        fallback_result = benchmark_model(FALLBACK_MODEL, ["fast-fallback"], output_tokens)
        results.append(fallback_result)
        if fallback_result.get("success"):
            fast_model = FALLBACK_MODEL
            fast_result = fallback_result

    quality_result = result_for(results, quality_model)
    if not passes(
        quality_result,
        min_tps=min_quality,
        min_offload=min_offload,
        gpu_expected=gpu_expected,
    ):
        quality_model = fast_model
        quality_result = result_for(results, quality_model) or fast_result

    models["fast"] = fast_model
    models["quality"] = quality_model
    if str(models.get("heavy") or "") == str(plan.get("models", {}).get("quality") or ""):
        models["heavy"] = quality_model
    plan["models"] = models

    chosen = [item for item in [fast_result, quality_result] if isinstance(item, dict)]
    max_offload = max(
        (float(item.get("gpuOffloadRatio") or 0.0) for item in chosen),
        default=0.0,
    )
    any_vram = max((int(item.get("vramBytes") or 0) for item in chosen), default=0)
    preferred = str(acceleration.get("preferred") or "")
    observed_backend = (
        "vulkan"
        if any_vram > 0 and preferred == "vulkan"
        else "gpu"
        if any_vram > 0
        else "cpu"
    )
    acceleration.update(
        {
            "gpuOffloadVerified": any_vram > 0,
            "observedBackend": observed_backend,
            "maxObservedGpuOffloadRatio": round(max_offload, 4),
        }
    )
    plan["acceleration"] = acceleration
    plan["selectedBy"] = "windows-ollama-benchmark"
    plan["selectionReason"] = (
        f"Measured on this PC with Ollama: Fast={fast_model}; Quality={quality_model}; "
        f"observed acceleration={observed_backend}; maximum measured GPU residency="
        f"{max_offload:.0%}. Quality automatically falls back to Fast when throughput "
        "or GPU-offload thresholds are not met."
    )
    plan["benchmarkRevision"] = BENCHMARK_REVISION
    plan["benchmarkedAt"] = datetime.now(timezone.utc).isoformat()
    PLAN_PATH.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    suite = {
        "revision": BENCHMARK_REVISION,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "selected": {
            "fast": fast_model,
            "quality": quality_model,
        },
        "acceleration": acceleration,
        "policy": {
            "fastMinTokensPerSecond": min_fast,
            "qualityMinTokensPerSecond": min_quality,
            "minimumGpuOffloadRatio": min_offload,
        },
        "results": results,
    }
    SUITE_PATH.write_text(json.dumps(suite, indent=2), encoding="utf-8")
    print(json.dumps(suite), flush=True)

    # Do not stop an already-running Ollama service. If this script started one,
    # leaving it warm allows the worker to launch without paying another load cost.
    if server_process and server_process.poll() is not None:
        raise RuntimeError("The benchmark Ollama process exited unexpectedly.")


if __name__ == "__main__":
    main()
