"""Adaptive Windows model planning for CoOperative Unison.

The planner detects Windows display adapters (including AMD/Intel cards that
nvidia-smi cannot see), records the expected acceleration path, and chooses
conservative Fast / Quality candidates. A separate benchmark step validates
those candidates on the actual Ollama backend and may downgrade a profile.
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

PLAN_REVISION = "2026-10-02.2"
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


def _powershell_json(script: str):
    for exe in ("powershell.exe", "powershell"):
        try:
            result = subprocess.run(
                [exe, "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout.strip())
        except Exception:
            continue
    return None


def cpu_name() -> str:
    value = _powershell_json(
        "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name) | ConvertTo-Json -Compress"
    )
    return str(value or "").strip()[:240]


def _known_vram_floor_mb(name: str) -> int:
    normalized = name.lower()
    # Polaris AdapterRAM is commonly truncated by Win32_VideoController because
    # the legacy field is 32-bit. These floors prevent an 8GB RX 590 from being
    # misclassified as a 4GB card.
    if re.search(r"radeon\s+(rx\s*)?590\b", normalized):
        return 8192
    if "rx 580" in normalized and ("8g" in normalized or "8 gb" in normalized):
        return 8192
    return 0


def _vendor_for_name(name: str) -> str:
    value = name.lower()
    if "nvidia" in value or "geforce" in value or "quadro" in value or "tesla" in value:
        return "nvidia"
    if "amd" in value or "radeon" in value:
        return "amd"
    if "intel" in value or "arc" in value:
        return "intel"
    return "unknown"


def windows_gpus() -> list[dict]:
    value = _powershell_json(
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name,AdapterRAM,DriverVersion,PNPDeviceID | "
        "ConvertTo-Json -Compress"
    )
    if value is None:
        return []
    rows = value if isinstance(value, list) else [value]
    gpus: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("Name") or "").strip()
        if not name:
            continue
        reported_mb = 0
        try:
            reported_mb = int(int(row.get("AdapterRAM") or 0) / (1024 * 1024))
        except Exception:
            reported_mb = 0
        memory_mb = max(reported_mb, _known_vram_floor_mb(name))
        vendor = _vendor_for_name(name)
        legacy_amd_vulkan = vendor == "amd" and bool(
            re.search(r"radeon\s+(rx\s*)?(4|5)\d{2}\b", name.lower())
        )
        gpus.append(
            {
                "name": name[:240],
                "vendor": vendor,
                "memoryTotalMb": memory_mb or None,
                "driverVersion": str(row.get("DriverVersion") or "")[:120],
                "pnpDeviceId": str(row.get("PNPDeviceID") or "")[:240],
                "accelerationPreference": (
                    "vulkan"
                    if legacy_amd_vulkan
                    else "gpu-auto"
                    if vendor in {"amd", "nvidia", "intel"}
                    else "unknown"
                ),
            }
        )
    return gpus[:16]


def nvidia_gpus() -> list[dict]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,driver_version",
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
            parts = [part.strip() for part in line.split(",")]
            if not parts or not parts[0]:
                continue
            try:
                memory_mb = int(float(parts[1])) if len(parts) > 1 else 0
            except ValueError:
                memory_mb = 0
            rows.append(
                {
                    "name": parts[0][:240],
                    "vendor": "nvidia",
                    "memoryTotalMb": memory_mb or None,
                    "driverVersion": parts[2][:120] if len(parts) > 2 else "",
                    "pnpDeviceId": "",
                    "accelerationPreference": "gpu-auto",
                }
            )
        return rows
    except Exception:
        return []


def detected_gpus() -> list[dict]:
    windows = windows_gpus()
    nvidia = nvidia_gpus()
    if not nvidia:
        return windows

    merged = list(windows)
    lower_names = {str(item.get("name") or "").lower() for item in merged}
    for item in nvidia:
        key = str(item.get("name") or "").lower()
        if key in lower_names:
            for existing in merged:
                if str(existing.get("name") or "").lower() == key:
                    existing["memoryTotalMb"] = max(
                        int(existing.get("memoryTotalMb") or 0),
                        int(item.get("memoryTotalMb") or 0),
                    ) or None
                    existing["driverVersion"] = item.get("driverVersion") or existing.get("driverVersion")
                    existing["vendor"] = "nvidia"
                    existing["accelerationPreference"] = "gpu-auto"
                    break
        else:
            merged.append(item)
    return merged[:16]


def choose_models(ram_mb: int, gpu_mb: int) -> tuple[dict, dict]:
    fast = "qwen2.5:1.5b"
    quality = "qwen2.5:3b"
    heavy = "qwen3:4b-instruct"

    if gpu_mb >= 3500 or ram_mb >= 12_000:
        fast = "qwen2.5:3b"
        quality = "qwen3:4b-instruct"
        heavy = "qwen3:8b" if ram_mb >= 14_000 else quality

    if gpu_mb >= 7000:
        fast = "qwen3:4b-instruct"
        quality = "qwen3:8b"
        heavy = "qwen3:14b" if ram_mb >= 24_000 else quality

    if gpu_mb >= 11_000 or ram_mb >= 28_000:
        fast = "qwen3:4b-instruct"
        quality = "qwen3:14b"
        heavy = "qwen3:30b" if ram_mb >= 40_000 else quality

    if gpu_mb >= 20_000 or ram_mb >= 56_000:
        fast = "qwen3:8b"
        quality = "qwen3:30b"
        heavy = "qwen3:32b"

    vision = "qwen2.5vl:3b"
    if gpu_mb >= 10_000 or ram_mb >= 24_000:
        vision = "qwen2.5vl:7b"
    if gpu_mb >= 24_000 or ram_mb >= 56_000:
        vision = "qwen2.5vl:32b"

    models = {"fast": fast, "quality": quality, "heavy": heavy, "vision": vision}
    candidates = {
        "fast": list(dict.fromkeys([fast, "qwen2.5:1.5b"])),
        "quality": list(dict.fromkeys([quality, fast])),
    }
    return models, candidates


def build_plan() -> dict:
    ram_mb = memory_total_mb()
    gpus = detected_gpus()
    max_gpu_mb = max((int(g.get("memoryTotalMb") or 0) for g in gpus), default=0)
    models, candidates = choose_models(ram_mb, max_gpu_mb)

    primary_gpu = max(
        gpus,
        key=lambda item: int(item.get("memoryTotalMb") or 0),
        default=None,
    )
    vendor = str((primary_gpu or {}).get("vendor") or "none")
    acceleration_preference = str(
        (primary_gpu or {}).get("accelerationPreference") or "cpu"
    )

    return {
        "revision": PLAN_REVISION,
        "backend": "ollama",
        "hardware": {
            "cpuLogical": os.cpu_count() or 1,
            "cpuName": cpu_name(),
            "memoryTotalMb": ram_mb,
            "freeDiskMb": free_disk_mb(),
            "gpus": gpus,
        },
        "acceleration": {
            "preferred": acceleration_preference,
            "primaryGpuVendor": vendor,
            "primaryGpuName": str((primary_gpu or {}).get("name") or ""),
            "gpuMemoryTotalMb": int((primary_gpu or {}).get("memoryTotalMb") or 0),
            "gpuOffloadVerified": False,
            "observedBackend": "",
        },
        "models": models,
        "candidates": candidates,
        "benchmarkPolicy": {
            "fastMinTokensPerSecond": 7.0,
            "qualityMinTokensPerSecond": 3.5,
            "minimumGpuOffloadRatio": 0.50 if primary_gpu else 0.0,
            "benchmarkOutputTokens": 96,
        },
        "install": {
            "preload": ["fast"],
            "lazy": ["quality", "heavy", "vision"],
            "note": (
                "Installer benchmarks Fast and Quality on Ollama. Quality is "
                "downgraded automatically if the measured node cannot sustain it."
            ),
        },
        "selectedBy": "hardware-plan",
        "selectionReason": (
            f"Detected {vendor} GPU capacity of {max_gpu_mb} MB and {ram_mb} MB RAM. "
            f"Preferred acceleration path is {acceleration_preference}. "
            "Fast and Quality remain provisional until the installer benchmark verifies "
            "real generation throughput and GPU offload."
        ),
    }


def main() -> None:
    plan = build_plan()
    PLAN_PATH.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(json.dumps(plan))


if __name__ == "__main__":
    main()
