"""Shared runtime helpers for CoOperative Unison compute nodes.

This module intentionally keeps node policy separate from the workload worker.
Workers ask whether the node may accept new work and emit heartbeats; the
CoOperative control plane remains responsible for routing and accounting.
"""

from __future__ import annotations

import ctypes
import os
import platform
import socket
import subprocess
import threading
import time
from typing import Callable

import httpx


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


QUEUE_URL = os.getenv(
    "COOPERATIVE_QUEUE_URL",
    "https://co-operative-mu.vercel.app",
).rstrip("/")
NODE_TOKEN = os.getenv("UNISON_NODE_SHARED_SECRET") or os.getenv("INFERENCE_WORKER_TOKEN")
NODE_ID = (
    os.getenv("UNISON_NODE_ID")
    or os.getenv("COOPERATIVE_WORKER_ID")
    or socket.gethostname()
)[:160]
NODE_NAME = (os.getenv("UNISON_NODE_NAME") or socket.gethostname())[:160]
NODE_OWNER_REF = os.getenv("UNISON_NODE_OWNER_REF", "platform-private")[:160]
NODE_CLASS = os.getenv("UNISON_NODE_CLASS", "private").lower()
if NODE_CLASS not in {"private", "business", "community"}:
    NODE_CLASS = "private"

IDLE_ONLY = _env_bool("UNISON_IDLE_ONLY", True)
IDLE_THRESHOLD_SECONDS = _env_int("UNISON_IDLE_THRESHOLD_SECONDS", 300, 0, 86400)
HEARTBEAT_SECONDS = _env_int("UNISON_HEARTBEAT_SECONDS", 20, 10, 300)
MAX_CPU_PERCENT = _env_int("UNISON_MAX_CPU_PERCENT", 50, 1, 100)
MAX_GPU_PERCENT = _env_int("UNISON_MAX_GPU_PERCENT", 80, 1, 100)
MAX_MEMORY_MB = _env_int("UNISON_MAX_MEMORY_MB", 8192, 256, 1048576)
NODE_PAUSED = _env_bool("UNISON_NODE_PAUSED", False)


class _LastInputInfo(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]


def windows_idle_seconds() -> float | None:
    if platform.system() != "Windows":
        return None

    try:
        info = _LastInputInfo()
        info.cbSize = ctypes.sizeof(_LastInputInfo)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return None
        now_ms = ctypes.windll.kernel32.GetTickCount()
        return max(0.0, (now_ms - info.dwTime) / 1000.0)
    except Exception:
        return None


def node_available() -> bool:
    if NODE_PAUSED:
        return False
    if not IDLE_ONLY:
        return True

    idle = windows_idle_seconds()
    if idle is None:
        # Idle detection is currently Windows-specific. Existing Mac workers stay
        # available unless explicitly paused while we add per-platform detectors.
        return True
    return idle >= IDLE_THRESHOLD_SECONDS


def node_state(busy: bool = False) -> str:
    if NODE_PAUSED:
        return "paused"
    if busy:
        return "busy"

    idle = windows_idle_seconds()
    if IDLE_ONLY and idle is not None:
        return "idle" if idle >= IDLE_THRESHOLD_SECONDS else "online"
    return "online"


def _memory_total_mb() -> int | None:
    try:
        if platform.system() == "Windows":
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

            status = MemoryStatusEx()
            status.dwLength = ctypes.sizeof(MemoryStatusEx)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.ullTotalPhys / (1024 * 1024))
            return None

        page_size = os.sysconf("SC_PAGE_SIZE")
        pages = os.sysconf("SC_PHYS_PAGES")
        return int((page_size * pages) / (1024 * 1024))
    except Exception:
        return None


def _detect_gpus() -> list[dict]:
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        if completed.returncode != 0:
            return []

        gpus = []
        for line in completed.stdout.splitlines():
            if not line.strip():
                continue
            parts = [part.strip() for part in line.split(",", 1)]
            name = parts[0][:240]
            memory = None
            if len(parts) > 1:
                try:
                    memory = max(0, int(float(parts[1])))
                except ValueError:
                    memory = None
            gpus.append({"name": name, "memoryTotalMb": memory})
        return gpus[:16]
    except Exception:
        return []


_HARDWARE = {
    "cpuLogical": os.cpu_count(),
    "memoryTotalMb": _memory_total_mb(),
    "gpus": _detect_gpus(),
    "maxCpuPercent": MAX_CPU_PERCENT,
    "maxGpuPercent": MAX_GPU_PERCENT,
    "maxMemoryMb": MAX_MEMORY_MB,
}


def heartbeat_payload(
    capabilities: list[str],
    worker_version: str,
    *,
    busy: bool = False,
) -> dict:
    return {
        "nodeId": NODE_ID,
        "displayName": NODE_NAME,
        "ownerRef": NODE_OWNER_REF,
        "nodeClass": NODE_CLASS,
        "state": node_state(busy),
        "platform": {
            "system": platform.system() or "unknown",
            "release": platform.release() or "",
            "machine": platform.machine() or "",
        },
        "capabilities": capabilities[:64],
        "resources": _HARDWARE,
        "policy": {
            "idleOnly": IDLE_ONLY,
            "idleThresholdSeconds": IDLE_THRESHOLD_SECONDS,
            "allowImage": "image_generation" in capabilities,
            "allowText": "text_generation" in capabilities,
        },
        "workerVersion": worker_version,
    }


def send_heartbeat(
    capabilities: list[str],
    worker_version: str,
    *,
    busy: bool = False,
) -> None:
    if not NODE_TOKEN:
        return

    response = httpx.post(
        f"{QUEUE_URL}/api/unison/nodes/heartbeat",
        headers={
            "Authorization": f"Bearer {NODE_TOKEN}",
            "Content-Type": "application/json",
        },
        json=heartbeat_payload(capabilities, worker_version, busy=busy),
        timeout=15.0,
        follow_redirects=True,
    )
    response.raise_for_status()


def start_heartbeat_thread(
    capabilities: list[str],
    worker_version: str,
    *,
    busy_provider: Callable[[], bool] | None = None,
) -> threading.Thread | None:
    if not NODE_TOKEN:
        print("Unison heartbeat disabled: no node/worker token configured.", flush=True)
        return None

    get_busy = busy_provider or (lambda: False)

    def loop():
        failures = 0
        while True:
            try:
                send_heartbeat(capabilities, worker_version, busy=bool(get_busy()))
                failures = 0
            except Exception as exc:
                failures += 1
                if failures == 1 or failures % 10 == 0:
                    print(f"Unison heartbeat error: {str(exc)[:500]}", flush=True)
            time.sleep(HEARTBEAT_SECONDS)

    thread = threading.Thread(target=loop, daemon=True, name="unison-heartbeat")
    thread.start()
    return thread
