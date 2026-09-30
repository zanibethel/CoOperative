# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.28.0"]
# ///

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

QUEUE_URL = os.getenv(
    "COOPERATIVE_QUEUE_URL",
    "https://co-operative-mu.vercel.app",
).rstrip("/")
POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_SUPERVISOR_POLL_SECONDS", "3")))
KEYCHAIN_SERVICE = os.getenv(
    "COOPERATIVE_WORKER_KEYCHAIN_SERVICE",
    "cooperative-inference-worker",
)
REPO_ROOT = Path(__file__).resolve().parents[1]
DISABLE_REPO_AGENT = os.getenv("COOPERATIVE_SUPERVISOR_DISABLE_REPO_AGENT") == "1"

children: dict[str, subprocess.Popen] = {}


def read_worker_token() -> str:
    token = os.getenv("INFERENCE_WORKER_TOKEN", "").strip()
    if token:
        return token

    user = os.getenv("USER", "").strip()
    if not user:
        raise RuntimeError("USER is unavailable and INFERENCE_WORKER_TOKEN is not set.")

    result = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            user,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError(
            "Worker token was not found in the environment or macOS Keychain. "
            "Save it once under service 'cooperative-inference-worker'."
        )
    return result.stdout.strip()


WORKER_TOKEN = read_worker_token()


def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def process_is_alive(name: str) -> bool:
    process = children.get(name)
    return bool(process and process.poll() is None)


def find_existing_worker_processes() -> list[str]:
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,command="],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    matches = []
    known = (
        "workers/mlx-text-worker.py",
        "workers/hf-image-worker.py",
        "workers/repo-agent-worker.py",
    )
    current_pid = os.getpid()
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(None, 1)
        if len(parts) != 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        if pid == current_pid:
            continue
        command = parts[1]
        if any(worker in command for worker in known):
            matches.append(stripped)
    return matches


def child_environment(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env["INFERENCE_WORKER_TOKEN"] = WORKER_TOKEN
    env["COOPERATIVE_QUEUE_URL"] = QUEUE_URL
    if extra:
        env.update(extra)
    return env


def start_child(name: str, script: str, extra_env: dict[str, str] | None = None):
    if process_is_alive(name):
        return
    print(f"[supervisor] starting {name}: {script}", flush=True)
    children[name] = subprocess.Popen(
        ["uv", "run", script],
        cwd=str(REPO_ROOT),
        env=child_environment(extra_env),
    )


def stop_child(name: str, timeout: float = 20.0):
    process = children.get(name)
    if not process or process.poll() is not None:
        children.pop(name, None)
        return

    print(f"[supervisor] stopping {name}...", flush=True)
    process.terminate()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"[supervisor] {name} did not exit; killing it.", flush=True)
        process.kill()
        process.wait(timeout=5)
    children.pop(name, None)


def queue_state() -> dict:
    response = httpx.get(
        f"{QUEUE_URL}/api/inference/local-queue/status",
        headers=headers(),
        timeout=20.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.json()


def desired_inference_worker(state: dict) -> str:
    text = state.get("text") or {}
    image = state.get("image") or {}

    text_queued = int(text.get("queued") or 0)
    text_running = int(text.get("running") or 0)
    image_queued = int(image.get("queued") or 0)
    image_running = int(image.get("running") or 0)

    if process_is_alive("text"):
        if text_running > 0 or text_queued > 0:
            return "text"
        if image_queued > 0 and image_running == 0:
            return "image"
        return "text"

    if process_is_alive("image"):
        if image_running > 0:
            return "image"
        if text_queued > 0:
            return "text"
        if image_queued > 0:
            return "image"
        return "text"

    if text_queued > 0:
        return "text"
    if image_queued > 0:
        return "image"

    # Default to the lightweight lazy-loading text worker so chat is ready
    # without preloading a model.
    return "text"


def ensure_repo_agent():
    if DISABLE_REPO_AGENT:
        return
    if not process_is_alive("repo"):
        start_child("repo", "workers/repo-agent-worker.py")


def ensure_inference_worker(desired: str, state: dict):
    if desired == "text":
        if process_is_alive("image"):
            image_running = int((state.get("image") or {}).get("running") or 0)
            if image_running > 0:
                return
            stop_child("image")
        if not process_is_alive("text"):
            start_child("text", "workers/mlx-text-worker.py")
        return

    if desired == "image":
        if process_is_alive("text"):
            text_running = int((state.get("text") or {}).get("running") or 0)
            if text_running > 0:
                return
            stop_child("text")
        if not process_is_alive("image"):
            start_child(
                "image",
                "workers/hf-image-worker.py",
                {"PRELOAD_PROFILE": "none"},
            )


def shutdown(*_args):
    print("\n[supervisor] shutting down local workers...", flush=True)
    for name in ("repo", "text", "image"):
        stop_child(name, timeout=10.0)
    raise SystemExit(0)


def main():
    existing = find_existing_worker_processes()
    if existing:
        print(
            "[supervisor] standalone CoOperative workers are already running.\n"
            "Stop the existing text/image/repo worker terminals with Ctrl+C before "
            "starting the supervisor, so it can safely own worker switching.",
            flush=True,
        )
        for line in existing:
            print(f"  {line}", flush=True)
        raise SystemExit(2)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"[supervisor] CoOperative local supervisor connected to {QUEUE_URL}.", flush=True)
    print(f"[supervisor] repo root: {REPO_ROOT}", flush=True)
    print("[supervisor] worker credential loaded from environment/Keychain.", flush=True)
    print(
        "[supervisor] policy: repo agent stays light; only one heavy inference "
        "worker (text/vision or image generation) runs at a time.",
        flush=True,
    )

    last_summary = None

    while True:
        try:
            ensure_repo_agent()
            state = queue_state()
            desired = desired_inference_worker(state)
            ensure_inference_worker(desired, state)

            summary = (
                int((state.get("text") or {}).get("queued") or 0),
                int((state.get("text") or {}).get("running") or 0),
                int((state.get("image") or {}).get("queued") or 0),
                int((state.get("image") or {}).get("running") or 0),
                desired,
            )
            if summary != last_summary:
                tq, tr, iq, ir, worker = summary
                print(
                    f"[supervisor] queues text={tq} queued/{tr} running; "
                    f"image={iq} queued/{ir} running; desired={worker}.",
                    flush=True,
                )
                last_summary = summary

            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            shutdown()
        except Exception as exc:
            print(f"[supervisor] loop error: {str(exc)[:1200]}", flush=True)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
