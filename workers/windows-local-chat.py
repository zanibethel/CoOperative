# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.0",
# ]
# ///

"""Loopback-only personal chat for a Windows Unison node.

This intentionally does not use the CoOperative cloud queue. The browser UI,
conversation history, prompt, and response stay on this PC. The only network
traffic needed for inference is local loopback traffic to the node's Ollama
runtime; model downloads may contact Ollama's model registry when a model is
first used.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import httpx

HERE = Path(__file__).resolve().parent
READY_MARKER = HERE / "local-chat.ready"
BUSY_MARKER = HERE / "local-chat.busy"

HOST = "127.0.0.1"
PORT = int(os.getenv("UNISON_LOCAL_CHAT_PORT", "11436"))
OLLAMA_URL = os.getenv("UNISON_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
FAST_MODEL = os.getenv("WINDOWS_TEXT_FAST_MODEL_ID", "qwen2.5:1.5b")
QUALITY_MODEL = os.getenv("WINDOWS_TEXT_QUALITY_MODEL_ID", FAST_MODEL)
HEAVY_MODEL = os.getenv("WINDOWS_TEXT_HEAVY_MODEL_ID", QUALITY_MODEL)
MODELS = {"fast": FAST_MODEL, "quality": QUALITY_MODEL, "heavy": HEAVY_MODEL}

_ollama_process: subprocess.Popen | None = None
_pull_lock = threading.Lock()

HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoOperative Local AI</title>
<style>
:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#08111b;color:#eef6ff}
*{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top,#102a3d 0,#08111b 42%);min-height:100vh}
.shell{max-width:980px;margin:0 auto;padding:24px}.top{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:18px}
.brand{font-weight:800;letter-spacing:.08em}.badge{font-size:.82rem;padding:6px 10px;border:1px solid #2b536d;border-radius:999px;color:#9eeaff}
.card{background:#0d1b28;border:1px solid #22394b;border-radius:18px;box-shadow:0 18px 55px #0008}
.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 16px}.toolbar select,.toolbar button{background:#122638;color:#eef6ff;border:1px solid #31506a;border-radius:10px;padding:9px 11px}
.toolbar button{cursor:pointer}.messages{height:min(62vh,680px);overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:82%;padding:12px 14px;border-radius:16px;white-space:pre-wrap;line-height:1.45}.user{align-self:flex-end;background:#164663}.assistant{align-self:flex-start;background:#172634}.muted{color:#91a9bb;font-size:.9rem}
.composer{padding:14px;border-top:1px solid #22394b;display:grid;grid-template-columns:1fr auto;gap:10px}.composer textarea{resize:vertical;min-height:72px;max-height:220px;background:#091723;color:#fff;border:1px solid #31506a;border-radius:12px;padding:12px;font:inherit}.composer button{min-width:92px;border:0;border-radius:12px;background:#dff9ff;color:#08111b;font-weight:700;padding:0 18px;cursor:pointer}
.error{color:#ffb4b4}.status{margin-left:auto}.privacy{margin:4px 0 0;color:#91a9bb;font-size:.88rem}
@media(max-width:640px){.shell{padding:12px}.messages{height:62vh}.msg{max-width:94%}.composer{grid-template-columns:1fr}.composer button{height:44px}.status{width:100%;margin-left:0}}
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div><div class="brand">CoOperative Local AI</div><div class="privacy">Personal chat on this PC. Chat content is not sent to CoOperative.</div></div>
    <div class="badge">LOCAL ONLY</div>
  </div>
  <div class="card">
    <div class="toolbar">
      <label>Model <select id="profile"><option value="fast">Fast</option><option value="quality">Quality</option><option value="heavy">Heavy</option></select></label>
      <button id="new">New chat</button>
      <span id="model" class="muted"></span>
      <span id="status" class="muted status">Ready</span>
    </div>
    <div id="messages" class="messages"></div>
    <div class="composer">
      <textarea id="input" placeholder="Ask your local AI anything…"></textarea>
      <button id="send">Send</button>
    </div>
  </div>
  <p id="error" class="error"></p>
</div>
<script>
const storeKey="cooperative.unison.local-chat.v1";
const $=id=>document.getElementById(id);
let messages=[];
function load(){try{messages=JSON.parse(localStorage.getItem(storeKey)||"[]");if(!Array.isArray(messages))messages=[]}catch{messages=[]}render()}
function save(){localStorage.setItem(storeKey,JSON.stringify(messages.slice(-40)))}
function render(){
  const box=$("messages"); box.innerHTML="";
  if(!messages.length){const e=document.createElement("div");e.className="muted";e.textContent="This conversation is stored only in this browser profile.";box.appendChild(e)}
  for(const m of messages){const d=document.createElement("div");d.className="msg "+(m.role==="user"?"user":"assistant");d.textContent=m.content;box.appendChild(d)}
  box.scrollTop=box.scrollHeight;
}
async function status(){
  try{const r=await fetch("/api/status",{cache:"no-store"});const j=await r.json();const p=$("profile").value;$("model").textContent=(j.models&&j.models[p])||""}catch{}
}
async function send(){
  const text=$("input").value.trim(); if(!text)return;
  $("error").textContent=""; $("input").value="";
  messages.push({role:"user",content:text});save();render();
  $("status").textContent="Thinking locally…"; $("send").disabled=true;
  try{
    const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:$("profile").value,messages:messages.slice(-30)})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||"Local AI request failed.");
    messages.push({role:"assistant",content:j.text});save();render();
    $("model").textContent=j.model||"";
    $("status").textContent=(j.tokensPerSecond?j.tokensPerSecond.toFixed(1)+" tok/s · ":"")+"Ready";
  }catch(e){$("error").textContent=e.message||String(e);$("status").textContent="Ready"}
  finally{$("send").disabled=false;$("input").focus()}
}
$("send").onclick=send;
$("input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
$("new").onclick=()=>{if(confirm("Start a new local conversation?")){messages=[];save();render()}};
$("profile").onchange=status;
load();status();$("input").focus();
</script>
</body>
</html>
"""


def allowed_origin(value: str | None) -> bool:
    if not value:
        return True
    try:
        parsed = urlparse(value)
        return parsed.hostname in {"127.0.0.1", "localhost"} and parsed.port == PORT
    except Exception:
        return False


def ollama_executable() -> str | None:
    configured = os.getenv("UNISON_OLLAMA_EXE")
    if configured and Path(configured).is_file():
        return configured
    direct = shutil.which("ollama")
    if direct:
        return direct
    candidates = [
        Path(os.getenv("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path(os.getenv("PROGRAMFILES", "")) / "Ollama" / "ollama.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def ollama_ready() -> bool:
    try:
        return httpx.get(f"{OLLAMA_URL}/api/version", timeout=2).is_success
    except Exception:
        return False


def ensure_ollama() -> None:
    global _ollama_process
    if ollama_ready():
        return
    executable = ollama_executable()
    if not executable:
        raise RuntimeError("The local model runtime is not installed yet.")
    _ollama_process = subprocess.Popen(
        [executable, "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    deadline = time.time() + 30
    while time.time() < deadline:
        if ollama_ready():
            return
        if _ollama_process.poll() is not None:
            break
        time.sleep(0.5)
    raise RuntimeError("The local model runtime did not start.")


def ensure_model(model: str) -> None:
    ensure_ollama()
    with _pull_lock:
        tags = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10).json()
        names = {
            str(item.get("name") or "")
            for item in tags.get("models", [])
            if isinstance(item, dict)
        }
        if model in names or any(name.startswith(f"{model}:") for name in names):
            return
        response = httpx.post(
            f"{OLLAMA_URL}/api/pull",
            json={"name": model, "stream": False},
            timeout=None,
        )
        response.raise_for_status()


def clean_messages(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value[-30:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        text = content.strip()
        if text:
            cleaned.append({"role": role, "content": text[:16000]})
    return cleaned


class Handler(BaseHTTPRequestHandler):
    server_version = "CoOperativeLocalAI/1.0"

    def log_message(self, *_args) -> None:
        return

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self) -> bool:
        return allowed_origin(self.headers.get("Origin"))

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/?"):
            body = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/status":
            self._json(
                200,
                {
                    "localOnly": True,
                    "ollamaReady": ollama_ready(),
                    "models": MODELS,
                    "port": PORT,
                },
            )
            return
        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if not self._origin_ok():
            self._json(403, {"error": "Local request origin rejected."})
            return
        if self.path != "/api/chat":
            self._json(404, {"error": "Not found."})
            return

        try:
            length = min(int(self.headers.get("Content-Length") or "0"), 512_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            profile = str(body.get("profile") or "fast").lower()
            if profile not in MODELS:
                profile = "fast"
            model = MODELS[profile]
            messages = clean_messages(body.get("messages"))
            if not messages:
                self._json(400, {"error": "A message is required."})
                return

            BUSY_MARKER.write_text(str(os.getpid()), encoding="utf-8")
            try:
                ensure_model(model)
                started = time.time()
                response = httpx.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": model,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are CoOperative Local AI, a private general-purpose assistant "
                                    "running on this computer. Be useful, clear, and concise. This is "
                                    "personal local chat, not a community-compute job."
                                ),
                            },
                            *messages,
                        ],
                        "stream": False,
                        "options": {"temperature": 0.3, "num_predict": 1200, "top_p": 0.9},
                    },
                    timeout=None,
                )
                response.raise_for_status()
                result = response.json()
                text = str((result.get("message") or {}).get("content") or "").strip()
                if not text:
                    raise RuntimeError("The local model returned an empty response.")
                output_tokens = int(result.get("eval_count") or 0)
                eval_ns = int(result.get("eval_duration") or 0)
                tps = (
                    output_tokens / (eval_ns / 1_000_000_000)
                    if output_tokens > 0 and eval_ns > 0
                    else None
                )
                self._json(
                    200,
                    {
                        "text": text,
                        "model": model,
                        "profile": profile,
                        "latencyMs": int((time.time() - started) * 1000),
                        "tokensPerSecond": tps,
                        "localOnly": True,
                    },
                )
            finally:
                try:
                    BUSY_MARKER.unlink()
                except FileNotFoundError:
                    pass
        except Exception as exc:
            self._json(500, {"error": str(exc)[:600]})


def main() -> None:
    READY_MARKER.write_text(f"http://{HOST}:{PORT}", encoding="utf-8")
    print(f"UNISON_LOCAL_CHAT_READY http://{HOST}:{PORT}", flush=True)
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    finally:
        for marker in (READY_MARKER, BUSY_MARKER):
            try:
                marker.unlink()
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    main()
