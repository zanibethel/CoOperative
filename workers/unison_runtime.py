"""Shared runtime helpers for CoOperative Unison compute nodes.

This module intentionally keeps node policy separate from the workload worker.
Workers ask whether the node may accept new work and emit heartbeats; the
CoOperative control plane remains responsible for routing and accounting.
"""

from __future__ import annotations

import ctypes
import json
import os
import platform
import socket
import subprocess
import threading
import time
from pathlib import Path
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
NODE_TOKEN = (
    os.getenv("UNISON_NODE_TOKEN")
    or os.getenv("UNISON_NODE_SHARED_SECRET")
    or os.getenv("INFERENCE_WORKER_TOKEN")
)
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


class _WTSSessionInfo(ctypes.Structure):
    _fields_ = [
        ("SessionId", ctypes.c_uint32),
        ("pWinStationName", ctypes.c_wchar_p),
        ("State", ctypes.c_int),
    ]


class _WTSInfo(ctypes.Structure):
    _fields_ = [
        ("State", ctypes.c_int),
        ("SessionId", ctypes.c_uint32),
        ("IncomingBytes", ctypes.c_uint32),
        ("OutgoingBytes", ctypes.c_uint32),
        ("IncomingFrames", ctypes.c_uint32),
        ("OutgoingFrames", ctypes.c_uint32),
        ("IncomingCompressedBytes", ctypes.c_uint32),
        ("OutgoingCompressedBytes", ctypes.c_uint32),
        ("WinStationName", ctypes.c_wchar * 33),
        ("Domain", ctypes.c_wchar * 18),
        ("UserName", ctypes.c_wchar * 21),
        ("ConnectTime", ctypes.c_longlong),
        ("DisconnectTime", ctypes.c_longlong),
        ("LastInputTime", ctypes.c_longlong),
        ("LogonTime", ctypes.c_longlong),
        ("CurrentTime", ctypes.c_longlong),
    ]


def _windows_machine_idle_seconds() -> float | None:
    """Return the least-idle interactive Windows session.

    Machine-wide Unison runs outside any one user's desktop session. GetLastInputInfo
    is session-scoped, so a service could otherwise think the PC is idle while another
    signed-in user is actively gaming. WTSInfo exposes LastInputTime for every
    interactive session; the minimum idle time keeps the node unavailable whenever
    anyone is using the computer.
    """
    try:
        wts = ctypes.WinDLL("wtsapi32", use_last_error=True)
        sessions_ptr = ctypes.POINTER(_WTSSessionInfo)()
        count = ctypes.c_uint32()

        enumerate_sessions = wts.WTSEnumerateSessionsW
        enumerate_sessions.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.POINTER(_WTSSessionInfo)),
            ctypes.POINTER(ctypes.c_uint32),
        ]
        enumerate_sessions.restype = ctypes.c_bool

        query_session = wts.WTSQuerySessionInformationW
        query_session.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_uint32),
        ]
        query_session.restype = ctypes.c_bool

        free_memory = wts.WTSFreeMemory
        free_memory.argtypes = [ctypes.c_void_p]
        free_memory.restype = None

        if not enumerate_sessions(None, 0, 1, ctypes.byref(sessions_ptr), ctypes.byref(count)):
            return None

        idle_values: list[float] = []
        try:
            for index in range(int(count.value)):
                session = sessions_ptr[index]
                buffer = ctypes.c_void_p()
                returned = ctypes.c_uint32()
                # WTSInfo = 18
                if not query_session(
                    None,
                    session.SessionId,
                    18,
                    ctypes.byref(buffer),
                    ctypes.byref(returned),
                ):
                    continue
                try:
                    if returned.value < ctypes.sizeof(_WTSInfo):
                        continue
                    info = ctypes.cast(buffer, ctypes.POINTER(_WTSInfo)).contents
                    if not str(info.UserName).strip():
                        continue
                    if info.CurrentTime <= 0 or info.LastInputTime <= 0:
                        continue
                    idle_values.append(
                        max(0.0, (info.CurrentTime - info.LastInputTime) / 10_000_000.0)
                    )
                finally:
                    if buffer:
                        free_memory(buffer)
        finally:
            if sessions_ptr:
                free_memory(sessions_ptr)

        if idle_values:
            return min(idle_values)

        # No interactive users are signed in, so the whole machine is available.
        return 1_000_000_000.0
    except Exception:
        return None


def _windows_session_idle_seconds() -> float | None:
    try:
        info = _LastInputInfo()
        info.cbSize = ctypes.sizeof(_LastInputInfo)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return None
        now_ms = ctypes.windll.kernel32.GetTickCount()
        return max(0.0, (now_ms - info.dwTime) / 1000.0)
    except Exception:
        return None


def windows_idle_seconds() -> float | None:
    if platform.system() != "Windows":
        return None

    if os.getenv("UNISON_INSTALL_SCOPE", "").strip().lower() == "machine":
        machine_idle = _windows_machine_idle_seconds()
        if machine_idle is not None:
            return machine_idle
        # Fail closed: a machine-wide worker must never infer idleness from
        # session 0 if whole-PC detection is unavailable.
        return 0.0

    return _windows_session_idle_seconds()


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

_RUNTIME_DIR = Path(__file__).resolve().parent
_MODEL_PLAN_PATH = _RUNTIME_DIR / "text-model-plan.json"
_TEXT_BENCHMARK_PATH = _RUNTIME_DIR / "text-benchmark.json"


def _read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def _dynamic_resources() -> dict:
    resources = dict(_HARDWARE)
    plan = _read_json(_MODEL_PLAN_PATH)
    if plan:
        resources["textModelPlan"] = {
            "revision": str(plan.get("revision") or "")[:80],
            "backend": str(plan.get("backend") or "")[:80],
            "models": {
                "fast": str((plan.get("models") or {}).get("fast") or "")[:160],
                "quality": str((plan.get("models") or {}).get("quality") or "")[:160],
                "heavy": str((plan.get("models") or {}).get("heavy") or "")[:160],
            },
            "selectionReason": str(plan.get("selectionReason") or "")[:1000],
        }

    benchmark = _read_json(_TEXT_BENCHMARK_PATH)
    if benchmark:
        resources["textBenchmark"] = {
            "profile": str(benchmark.get("profile") or "")[:32],
            "model": str(benchmark.get("model") or "")[:160],
            "provider": str(benchmark.get("provider") or "")[:120],
            "outputTokens": max(0, int(benchmark.get("outputTokens") or 0)),
            "latencyMs": max(0, int(benchmark.get("latencyMs") or 0)),
            "tokensPerSecond": (
                float(benchmark["tokensPerSecond"])
                if isinstance(benchmark.get("tokensPerSecond"), (int, float))
                else None
            ),
            "recordedAt": str(benchmark.get("recordedAt") or "")[:80],
        }
    return resources


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
        "resources": _dynamic_resources(),
        "policy": {
            "idleOnly": IDLE_ONLY,
            "idleThresholdSeconds": IDLE_THRESHOLD_SECONDS,
            "allowImage": "image_generation" in capabilities,
            "allowText": "text_generation" in capabilities,
            "idleScope": (
                "machine"
                if os.getenv("UNISON_INSTALL_SCOPE", "").strip().lower() == "machine"
                else "session"
            ),
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
