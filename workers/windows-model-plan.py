"""Adaptive Windows text-model plan for CoOperative Unison.

The planner deliberately separates hardware eligibility from real performance.
It chooses a conservative Fast / Quality / Heavy candidate set from RAM and GPU
capacity. The worker records real generation benchmarks later so routing can
become evidence-based instead of relying on a single synthetic power score.
"""

from __future__ import annotations

import ctypes
import json
import os
import shutil
import subprocess
from pathlib import Path

PLAN_REVISION = "2026-10-01.1"
HERE = Path(__file__).resolve().parent
PLAN_PATH = HERE / "text-model-plan.json"


class MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def memory_total_mb() -> int:
    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(MemoryStatusEx)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return int(status.ullTotalPhys / (1024 * 1024))
    return 0


def free_disk_mb() -> int:
    usage = shutil.disk_usage(HERE)
    return int(usage.free / (1024 * 1024))


def nvidia_gpus() -> list[dict]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode != 0:
            return []
        rows = []
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            name, _, memory = line.partition(",")
            try:
                memory_mb = int(float(memory.strip()))
            except ValueError:
                memory_mb = 0
            rows.append({"name": name.strip(), "memoryTotalMb": memory_mb})
        return rows
    except Exception:
        return []


def choose_models(ram_mb: int, gpu_mb: int) -> dict:
    fast = "qwen2.5:1.5b"
    quality = "qwen2.5:3b"
    heavy = "qwen3:4b-instruct"

    effective_mb = max(ram_mb, gpu_mb * 2 if gpu_mb else 0)

    if effective_mb >= 10_000:
        quality = "qwen3:4b-instruct"
        heavy = "qwen3:8b"
    if effective_mb >= 20_000 or gpu_mb >= 10_000:
        fast = "qwen3:4b-instruct"
        quality = "qwen3:8b"
        heavy = "qwen3:14b"
    if effective_mb >= 32_000 or gpu_mb >= 16_000:
        quality = "qwen3:14b"
        heavy = "qwen3:30b-instruct"
    if effective_mb >= 56_000 or gpu_mb >= 24_000:
        fast = "qwen3:8b"
        quality = "qwen3:30b-instruct"
        heavy = "qwen3:32b"

    return {"fast": fast, "quality": quality, "heavy": heavy}


def build_plan() -> dict:
    ram_mb = memory_total_mb()
    gpus = nvidia_gpus()
    max_gpu_mb = max((int(g.get("memoryTotalMb") or 0) for g in gpus), default=0)
    models = choose_models(ram_mb, max_gpu_mb)

    return {
        "revision": PLAN_REVISION,
        "backend": "ollama",
        "hardware": {
            "cpuLogical": os.cpu_count() or 1,
            "memoryTotalMb": ram_mb,
            "freeDiskMb": free_disk_mb(),
            "gpus": gpus,
        },
        "models": models,
        "install": {
            "preload": ["fast"],
            "lazy": ["quality", "heavy"],
            "note": (
                "Fast is preloaded for immediate work. Quality and Heavy remain lazy "
                "until a routed workload needs them, avoiding unnecessary downloads."
            ),
        },
        "selectionReason": (
            "Selected from available RAM and NVIDIA VRAM with operating-system headroom. "
            "Real job throughput is benchmarked after execution and should supersede "
            "hardware-only assumptions."
        ),
    }


def main() -> None:
    plan = build_plan()
    PLAN_PATH.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(json.dumps(plan))


if __name__ == "__main__":
    main()
