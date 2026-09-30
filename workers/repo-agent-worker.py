# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.28.0"]
# ///

from __future__ import annotations
import json, os, re, shlex, socket, subprocess, time
from pathlib import Path
from typing import Any
import httpx

QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
WORKER_TOKEN = os.getenv("INFERENCE_WORKER_TOKEN")
WORKER_ID = os.getenv("COOPERATIVE_AGENT_WORKER_ID", f"{socket.gethostname()}-repo-agent")[:160]
POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_AGENT_QUEUE_POLL_SECONDS", "4")))
WORKSPACE_ROOT = Path(os.getenv("COOPERATIVE_AGENT_WORKSPACE_ROOT", str(Path.cwd().parent))).expanduser().resolve()
WORKTREE_ROOT = Path(os.getenv("COOPERATIVE_AGENT_WORKTREE_ROOT", str(WORKSPACE_ROOT / ".cooperative-agent-worktrees"))).expanduser().resolve()

BLOCKED_PARTS = {".git","node_modules",".next",".vercel","dist","build","vendor","__pycache__"}
BLOCKED_NAMES = {".env",".env.local",".env.production",".env.development","package-lock.json","pnpm-lock.yaml","yarn.lock"}
BLOCKED_SUFFIXES = {".pem",".key",".p12",".pfx",".crt",".cer"}
SAFE_WRITE_SUFFIXES = {".ts",".tsx",".js",".jsx",".mjs",".cjs",".py",".md",".json",".css",".scss",".html",".yml",".yaml",".toml"}
MAX_WRITE_FILES = 6
MAX_TOTAL_WRITE_CHARS = 140000

class AgentError(RuntimeError):
    pass

def headers():
    if not WORKER_TOKEN:
        raise AgentError("INFERENCE_WORKER_TOKEN is required.")
    return {"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"}

def run(args, cwd, timeout=90, check=True):
    result = subprocess.run(args, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
    if check and result.returncode != 0:
        command = " ".join(shlex.quote(arg) for arg in args)
        raise AgentError(f"Command failed ({result.returncode}): {command}\n{result.stdout[-5000:]}")
    return result

def post(path, payload, timeout=60.0):
    response = httpx.post(f"{QUEUE_URL}{path}", headers=headers(), json=payload, timeout=timeout, follow_redirects=True)
    response.raise_for_status()
    return response

def progress(task_id, message, kind="progress", status=None, metadata=None, branch_name=None):
    payload = {"taskId": task_id, "kind": kind, "message": message}
    if status: payload["status"] = status
    if metadata is not None: payload["metadata"] = metadata
    if branch_name: payload["branchName"] = branch_name
    result = post("/api/agents/tasks/progress", payload).json()
    if result.get("cancelled"):
        raise AgentError("Task was cancelled.")

def complete(task_id, status, result=None, error=None, branch_name=None):
    payload = {"taskId": task_id, "status": status}
    if result is not None: payload["result"] = result
    if error: payload["error"] = error[:4000]
    if branch_name: payload["branchName"] = branch_name
    return post("/api/agents/tasks/complete", payload).json()

def normalize_remote(value):
    value = re.sub(r"^git@github\.com:", "https://github.com/", value.strip())
    value = re.sub(r"\.git$", "", value)
    return value.rstrip("/").lower()

def ensure_repo(repository):
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    github_repo = str(repository["githubRepo"])
    expected = f"https://github.com/{github_repo}".lower()

    candidates = []
    configured = (WORKSPACE_ROOT / str(repository["localDirName"])).resolve()
    candidates.append(configured)

    for child in WORKSPACE_ROOT.iterdir():
        if not child.is_dir() or child == configured:
            continue
        if (child / ".git").exists():
            candidates.append(child.resolve())

    for repo in candidates:
        if repo != configured and WORKSPACE_ROOT not in repo.parents:
            continue
        if not (repo / ".git").exists():
            continue
        remote = run(["git","remote","get-url","origin"], repo, check=False).stdout.strip()
        if remote and normalize_remote(remote) == expected:
            print(f"Using approved existing checkout {repo}.")
            return repo

    repo = configured
    if WORKSPACE_ROOT not in repo.parents:
        raise AgentError("Resolved repository path escaped the approved workspace.")
    if repo.exists() and any(repo.iterdir()):
        raise AgentError(f"{repo} exists but is not the approved Git repository; refusing to overwrite it.")

    print(f"Cloning approved repository {github_repo} to {repo}...")
    run(["git","clone",f"https://github.com/{github_repo}.git",str(repo)], WORKSPACE_ROOT, timeout=240)
    remote = run(["git","remote","get-url","origin"], repo).stdout.strip()
    if normalize_remote(remote) != expected:
        raise AgentError(f"Repository origin mismatch. Expected {github_repo}; found {remote}.")
    return repo

def safe_path(repo, relative, write=False, memory_only=False, memory_files=None):
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise AgentError(f"Unsafe repository path: {relative}")
    if any(part in BLOCKED_PARTS for part in rel.parts):
        raise AgentError(f"Blocked repository path: {relative}")
    if rel.name in BLOCKED_NAMES or rel.suffix.lower() in BLOCKED_SUFFIXES:
        raise AgentError(f"Sensitive repository path is blocked: {relative}")
    resolved = (repo / rel).resolve()
    if repo != resolved and repo not in resolved.parents:
        raise AgentError(f"Repository path escaped approved root: {relative}")
    if write:
        normalized = resolved.relative_to(repo).as_posix()
        if memory_only and normalized not in (memory_files or []):
            raise AgentError(f"Project Memory may not modify {normalized}.")
        if resolved.suffix.lower() not in SAFE_WRITE_SUFFIXES:
            raise AgentError(f"File type is not allowed for automatic preparation: {normalized}")
        low = normalized.lower()
        if "migration" in low or low.startswith(".github/") or "secret" in low or "credential" in low or "billing" in low or "auth" in Path(low).name:
            raise AgentError(f"High-impact path requires human-managed work: {normalized}")
    return resolved

def update_remote(repo, branch):
    run(["git","fetch","origin",branch], repo, timeout=180)

def create_worktree(source_repo, repository, task_id):
    branch_base = str(repository.get("defaultBranch") or "main")
    update_remote(source_repo, branch_base)
    safe_task = re.sub(r"[^a-zA-Z0-9-]", "-", task_id)[:36]
    branch = f"agent/{safe_task}"
    repo_dir = re.sub(r"[^a-zA-Z0-9._-]", "-", str(repository["localDirName"]))
    worktree = (WORKTREE_ROOT / repo_dir / safe_task).resolve()
    worktree.parent.mkdir(parents=True, exist_ok=True)
    if worktree.exists():
        raise AgentError(f"Agent worktree already exists at {worktree}.")
    run(["git","worktree","add","-b",branch,str(worktree),f"origin/{branch_base}"], source_repo, timeout=180)
    source_modules = source_repo / "node_modules"
    target_modules = worktree / "node_modules"
    if source_modules.is_dir() and not target_modules.exists():
        try: target_modules.symlink_to(source_modules, target_is_directory=True)
        except OSError: pass
    return worktree, branch

def objective_terms(objective):
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", objective.lower())
    ignored = {"this","that","with","from","into","when","what","where","have","should","would","could","need","make","using","update","change","code","repo","repository","agent"}
    result = []
    for word in words:
        if word not in ignored and word not in result:
            result.append(word)
        if len(result) >= 8: break
    return result

def collect_context(repo, objective, repository):
    status = run(["git","status","--short"], repo).stdout[-5000:]
    recent = run(["git","log","-8","--oneline","--decorate"], repo).stdout[-5000:]
    tracked = run(["git","ls-files"], repo).stdout.splitlines()
    search_lines, candidate_paths = [], []
    for term in objective_terms(objective):
        result = run(["git","grep","-n","-I","-m","12","-e",term,"--"], repo, timeout=30, check=False)
        if result.returncode not in {0,1}: continue
        for line in result.stdout.splitlines()[:12]:
            search_lines.append(line[:1200])
            path = line.split(":",1)[0]
            if path in tracked and path not in candidate_paths: candidate_paths.append(path)
    for memory_file in repository.get("memoryFiles", []):
        if memory_file in tracked and memory_file not in candidate_paths: candidate_paths.append(memory_file)
    files, total = [], 0
    for relative in candidate_paths[:10]:
        try: path = safe_path(repo, relative)
        except AgentError: continue
        if not path.is_file(): continue
        try: body = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError,OSError): continue
        excerpt = body[:7000]
        if total + len(excerpt) > 24000: excerpt = excerpt[:max(0,24000-total)]
        if not excerpt: continue
        files.append({"path":relative,"content":excerpt})
        total += len(excerpt)
        if total >= 24000: break
    sections = [
        "GIT STATUS:\n" + (status or "(clean)"),
        "RECENT COMMITS:\n" + recent,
        "TRACKED FILES:\n" + "\n".join(tracked[:500]),
        "SEARCH MATCHES:\n" + ("\n".join(search_lines[:80]) or "(none)")
    ]
    for item in files:
        sections.append(f"FILE: {item['path']}\n---\n{item['content']}\n---")
    return {"text":"\n\n".join(sections)[:30000],"files":[x["path"] for x in files],"terms":objective_terms(objective)}

def queue_llm(task_id, profile, messages, max_tokens):
    response = post("/api/agents/tasks/llm", {"taskId":task_id,"messages":messages,"profile":profile,"maxTokens":max_tokens,"temperature":0.1})
    return str(response.json()["jobId"])

def wait_llm(task_id, job_id):
    while True:
        response = httpx.get(f"{QUEUE_URL}/api/agents/tasks/llm", headers=headers(), params={"taskId":task_id,"jobId":job_id}, timeout=30.0, follow_redirects=True)
        response.raise_for_status()
        result = response.json()
        if result.get("status") == "completed": return result
        if result.get("status") in {"failed","cancelled"}:
            raise AgentError(result.get("error") or f"Local AI job {result.get('status')}.")
        time.sleep(1.5)

def system_prompt(agent, mode):
    common = (
        "You are a bounded CoOperative local repo agent. Use supplied repository evidence only. "
        "Do not invent files or state. Prefer deterministic code and existing project patterns. "
        "Never request, reveal, or modify secrets. Never propose production pushes, deployments, "
        "destructive operations, migrations, auth/billing/access-control changes, or arbitrary shell commands. "
        "Preserve working architecture and make the smallest justified change. "
    )
    if mode in {"prepare_change","update_memory"}:
        return common + (
            'Return ONLY valid JSON shaped {"summary":"short explanation","files":[{"path":"relative/path","content":"complete UTF-8 file contents"}]}. '
            f"At most {MAX_WRITE_FILES} files. Every file content must be complete, not a diff. "
            "If safe work cannot be prepared from evidence, use an empty files array."
        )
    if mode == "verify":
        return common + (
            "Verification is evidence-bound. Every factual finding must name its supporting evidence "
            "using one of: GIT STATUS, RECENT COMMITS, TRACKED FILES, SEARCH MATCHES, FILE <path>, "
            "or CHECK <command>. Never mention a tool, file, command, policy, or behavior that is not "
            "explicitly present in the supplied evidence or objective. A failed or skipped deterministic "
            "check cannot be described as passing. If evidence is insufficient, say INCONCLUSIVE. "
            "Separate verified facts from uncertainty and give only evidence-supported next actions."
        )
    return common + "Analyze the objective using evidence, concrete findings, uncertainty, and the next deterministic action."

def parse_plan(text):
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start: raise AgentError("Local AI did not return required JSON.")
    try:
        value = json.loads(text[start:end+1], strict=False)
    except json.JSONDecodeError as exc:
        raise AgentError(f"Local AI returned invalid JSON: {exc}") from exc
    if not isinstance(value, dict): raise AgentError("Local AI response was not an object.")
    return value

def apply_plan(repo, plan, memory_only, memory_files):
    files = plan.get("files")
    if not isinstance(files,list): raise AgentError("Local AI response has no files array.")
    if len(files) > MAX_WRITE_FILES: raise AgentError("Local AI proposed too many files.")
    changed, total = [], 0
    for item in files:
        if not isinstance(item,dict) or not isinstance(item.get("path"),str) or not isinstance(item.get("content"),str):
            raise AgentError("Invalid file operation from Local AI.")
        total += len(item["content"])
        if total > MAX_TOTAL_WRITE_CHARS: raise AgentError("Proposed file content exceeds v1 safety limit.")
        path = safe_path(repo, item["path"], write=True, memory_only=memory_only, memory_files=memory_files)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(item["content"], encoding="utf-8")
        changed.append(path.relative_to(repo).as_posix())
    return changed

def run_checks(repo, commands):
    results = []
    for command in commands[:4]:
        parts = shlex.split(command)
        allowed = parts and (parts[:2] in [["npm","run"],["pnpm","run"],["yarn","run"]] or parts[0] in {"pytest","ruff"})
        if not allowed:
            results.append({"command":command,"passed":False,"output":"Command is not allowlisted."})
            continue
        if parts[0] in {"npm","pnpm","yarn"} and not (repo / "node_modules").exists():
            results.append({
                "command": command,
                "passed": False,
                "skipped": True,
                "output": "Deterministic check not run: node_modules is not available in this checkout."
            })
            continue
        result = run(parts, repo, timeout=300, check=False)
        results.append({
            "command":command,
            "passed":result.returncode==0,
            "skipped":False,
            "output":result.stdout[-12000:]
        })
    return results

def handle_task(task):
    task_id = str(task["taskId"])
    agent, repository = task["agent"], task["repository"]
    mode, objective = str(task["mode"]), str(task["objective"])
    profile = str(task.get("requestedProfile") or agent.get("preferredProfile") or "fast")

    source = ensure_repo(repository)
    progress(task_id, f"Approved repo resolved at {source}.", metadata={"githubRepo":repository["githubRepo"]})
    target, branch = source, None
    if mode in {"prepare_change","update_memory"}:
        target, branch = create_worktree(source, repository, task_id)
        progress(task_id, f"Created isolated agent branch {branch}.", branch_name=branch)
    else:
        update_remote(source, str(repository.get("defaultBranch") or "main"))

    context = collect_context(target, objective, repository)
    progress(task_id, "Repository evidence collected deterministically.", metadata={"candidateFiles":context["files"],"searchTerms":context["terms"]})

    checks = []
    if mode == "verify":
        checks = run_checks(target, list(repository.get("checks",[])))
        progress(task_id, "Allowlisted verification checks completed.", metadata={"checks":[{"command":x["command"],"passed":x["passed"]} for x in checks]})

    evidence = context["text"]
    if checks:
        check_evidence = []
        for item in checks:
            check_evidence.append(
                f"CHECK {item['command']}: passed={item.get('passed', False)} "
                f"skipped={item.get('skipped', False)}\n{item.get('output', '')}"
            )
        evidence += "\n\nDETERMINISTIC CHECK RESULTS:\n" + "\n\n".join(check_evidence)
    messages = [
        {"role":"system","content":system_prompt(agent,mode)},
        {"role":"user","content":(f"AGENT: {agent['name']}\nMODE: {mode}\nREPOSITORY: {repository['githubRepo']}\nOBJECTIVE:\n{objective}\n\nREPOSITORY EVIDENCE:\n{evidence[:14000]}")[:16000]},
    ]
    if len(evidence) > 14000:
        messages.append({"role":"user","content":("ADDITIONAL REPOSITORY EVIDENCE:\n"+evidence[14000:28000])[:16000]})

    progress(task_id, "Local AI reasoning requested.", status="waiting_llm")
    llm_id = queue_llm(task_id, profile, messages, 2400 if mode in {"prepare_change","update_memory"} else 1400)
    llm = wait_llm(task_id, llm_id)
    text = str(llm.get("text") or "")
    progress(task_id, "Local AI reasoning completed.", status="running", metadata={"model":llm.get("model"),"latencyMs":llm.get("latencyMs"),"promptTokens":llm.get("promptTokens"),"outputTokens":llm.get("outputTokens")})

    if mode in {"inspect","verify"}:
        complete(task_id, "completed", result={
            "analysis": text,
            "checks": checks,
            "verificationPassed": (
                mode != "verify"
                or (
                    bool(checks)
                    and all(item.get("passed") is True and not item.get("skipped", False) for item in checks)
                )
            ),
            "repository": repository["githubRepo"],
            "model": llm.get("model"),
            "profile": profile
        })
        return

    plan = parse_plan(text)
    changed = apply_plan(target, plan, mode=="update_memory", list(repository.get("memoryFiles",[])))
    if changed:
        diff_check = run(["git","diff","--check"], target, check=False)
        checks = [{"command":"git diff --check","passed":diff_check.returncode==0,"output":diff_check.stdout[-8000:]}]
        if diff_check.returncode == 0: checks.extend(run_checks(target, list(repository.get("checks",[]))))
    else:
        checks = []
    diff_stat = run(["git","diff","--stat"], target, check=False).stdout[-12000:]
    diff = run(["git","diff","--no-ext-diff"], target, check=False).stdout[-50000:]
    complete(task_id, "needs_approval", branch_name=branch, result={
        "summary":plan.get("summary") or "Prepared bounded repository change.",
        "changedFiles":changed,
        "checksPassed":bool(checks) and all(x["passed"] for x in checks),
        "checks":checks,
        "diffStat":diff_stat,
        "diff":diff,
        "repository":repository["githubRepo"],
        "worktree":str(target),
        "model":llm.get("model"),
        "profile":profile,
    })

def queue_loop():
    print(f"CoOperative repo agent polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    print(f"Approved workspace root: {WORKSPACE_ROOT}")
    print("Agent writes use isolated local worktrees; push/deploy remain human-gated.")
    while True:
        task_id = None
        try:
            response = post("/api/agents/tasks/claim", {"workerId":WORKER_ID}, timeout=30.0)
            if response.status_code == 204:
                time.sleep(POLL_SECONDS)
                continue
            task = response.json()
            task_id = str(task["taskId"])
            print(f"Claimed agent task {task_id}: {task['agentKey']} / {task['repoKey']} / {task['mode']}")
            handle_task(task)
            print(f"Agent task {task_id} finished its local worker phase.")
        except KeyboardInterrupt:
            print("Repo agent worker stopped.")
            return
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 204:
                time.sleep(POLL_SECONDS)
                continue
            message = f"HTTP {exc.response.status_code}: {exc.response.text[:1200]}"
            print(f"Agent worker error: {message}")
            if task_id:
                try: complete(task_id, "failed", error=message)
                except Exception as completion_error: print(f"Could not report task failure: {completion_error}")
            time.sleep(POLL_SECONDS)
        except Exception as exc:
            message = str(exc)[:3000]
            print(f"Agent worker error: {message}")
            if task_id:
                try: complete(task_id, "failed", error=message)
                except Exception as completion_error: print(f"Could not report task failure: {completion_error}")
            time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    if not WORKER_TOKEN:
        raise AgentError("INFERENCE_WORKER_TOKEN is required.")
    queue_loop()
