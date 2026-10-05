# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.28.0"]
# ///

from __future__ import annotations
import ast, difflib, json, os, re, shlex, shutil, socket, subprocess, time
from pathlib import Path
from typing import Any
import httpx

QUEUE_URL = os.getenv("COOPERATIVE_QUEUE_URL", "https://co-operative-mu.vercel.app").rstrip("/")
WORKER_TOKEN = os.getenv("INFERENCE_WORKER_TOKEN") or os.getenv("UNISON_NODE_TOKEN")
NODE_ID = (os.getenv("UNISON_NODE_ID") or "").strip()
WORKER_ID = os.getenv(
    "COOPERATIVE_AGENT_WORKER_ID",
    f"{NODE_ID or socket.gethostname()}-repo-agent",
)[:160]
POLL_SECONDS = max(2, int(os.getenv("COOPERATIVE_AGENT_QUEUE_POLL_SECONDS", "4")))
LOCAL_REASONING_TIMEOUT_SECONDS = max(
    120,
    int(os.getenv("COOPERATIVE_AGENT_REASONING_TIMEOUT_SECONDS", "900")),
)
WORKSPACE_ROOT = Path(os.getenv("COOPERATIVE_AGENT_WORKSPACE_ROOT", str(Path.cwd().parent))).expanduser().resolve()
WORKTREE_ROOT = Path(os.getenv("COOPERATIVE_AGENT_WORKTREE_ROOT", str(WORKSPACE_ROOT / ".cooperative-agent-worktrees"))).expanduser().resolve()

BLOCKED_PARTS = {".git","node_modules",".next",".vercel","dist","build","vendor","__pycache__"}
BLOCKED_NAMES = {".env",".env.local",".env.production",".env.development","package-lock.json","pnpm-lock.yaml","yarn.lock"}
BLOCKED_SUFFIXES = {".pem",".key",".p12",".pfx",".crt",".cer"}
SAFE_WRITE_SUFFIXES = {".ts",".tsx",".js",".jsx",".mjs",".cjs",".py",".md",".json",".css",".scss",".html",".yml",".yaml",".toml"}
MAX_WRITE_FILES = 6
MAX_TOTAL_WRITE_CHARS = 140000
SANDBOX_BRANCH_PREFIX = "sandbox/"

class AgentError(RuntimeError):
    pass

def headers():
    if not WORKER_TOKEN:
        raise AgentError("A local worker or Unison node token is required.")
    value = {
        "Authorization": f"Bearer {WORKER_TOKEN}",
        "Content-Type": "application/json",
    }
    if NODE_ID:
        value["X-Cooperative-Node-Id"] = NODE_ID
    return value

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

def _valid_sandbox_branch(branch):
    return (
        isinstance(branch, str)
        and branch.startswith(SANDBOX_BRANCH_PREFIX)
        and ".." not in branch
        and re.fullmatch(r"[A-Za-z0-9._/-]{1,220}", branch) is not None
    )

def create_worktree(source_repo, repository, task_id, continuation_branch=None):
    branch_base = str(repository.get("defaultBranch") or "main")
    safe_task = re.sub(r"[^a-zA-Z0-9-]", "-", task_id)[:36]
    repo_dir = re.sub(r"[^a-zA-Z0-9._-]", "-", str(repository["localDirName"]))
    worktree = (WORKTREE_ROOT / repo_dir / safe_task).resolve()
    worktree.parent.mkdir(parents=True, exist_ok=True)

    if worktree.exists():
        listed = run(
            ["git", "worktree", "list", "--porcelain"],
            source_repo,
            timeout=30,
            check=False,
        ).stdout
        registered = f"worktree {worktree}" in listed
        if registered:
            run(
                ["git", "worktree", "remove", "--force", str(worktree)],
                source_repo,
                timeout=120,
                check=False,
            )
        if worktree.exists():
            shutil.rmtree(worktree, ignore_errors=False)

    if continuation_branch:
        if not _valid_sandbox_branch(continuation_branch):
            raise AgentError("Requested continuation branch is not an approved sandbox branch.")
        branch = continuation_branch
        update_remote(source_repo, branch)
        run(
            ["git", "worktree", "add", "--detach", str(worktree), f"origin/{branch}"],
            source_repo,
            timeout=180,
        )
    else:
        update_remote(source_repo, branch_base)
        branch = f"{SANDBOX_BRANCH_PREFIX}task-{safe_task[:12]}"
        existing_branch = run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
            source_repo,
            timeout=30,
            check=False,
        ).returncode == 0
        if existing_branch:
            run(
                ["git", "branch", "-D", branch],
                source_repo,
                timeout=30,
                check=False,
            )
        run(
            ["git", "worktree", "add", "-b", branch, str(worktree), f"origin/{branch_base}"],
            source_repo,
            timeout=180,
        )

    source_modules = source_repo / "node_modules"
    target_modules = worktree / "node_modules"
    if source_modules.is_dir() and not target_modules.exists():
        try:
            target_modules.symlink_to(source_modules, target_is_directory=True)
        except OSError:
            pass
    return worktree, branch

def push_sandbox_branch(repo, branch, changed_files, summary):
    if not _valid_sandbox_branch(branch):
        raise AgentError("Refusing to push a non-sandbox branch.")
    if not changed_files:
        return {"pushed": False, "commitSha": None, "reason": "no-changes"}

    run(["git", "config", "user.name", "CoOperative Sandbox Agent"], repo, check=False)
    run(["git", "config", "user.email", "sandbox@cooperative.local"], repo, check=False)
    run(["git", "add", "--", *changed_files], repo, timeout=60)

    cached = run(["git", "diff", "--cached", "--quiet"], repo, check=False)
    if cached.returncode == 0:
        return {"pushed": False, "commitSha": None, "reason": "no-staged-changes"}

    compact_summary = re.sub(r"\s+", " ", str(summary or "Prepared sandbox change")).strip()[:96]
    run(
        ["git", "commit", "-m", f"Sandbox change: {compact_summary}"],
        repo,
        timeout=120,
    )
    commit_sha = run(["git", "rev-parse", "HEAD"], repo).stdout.strip()
    push = run(
        ["git", "push", "origin", f"HEAD:refs/heads/{branch}"],
        repo,
        timeout=240,
        check=False,
    )
    if push.returncode != 0:
        return {
            "pushed": False,
            "commitSha": commit_sha,
            "reason": "push-failed",
            "output": push.stdout[-6000:],
        }
    return {"pushed": True, "commitSha": commit_sha, "reason": "pushed"}

def objective_terms(objective):
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", objective.lower())
    ignored = {"this","that","with","from","into","when","what","where","have","should","would","could","need","make","using","update","change","code","repo","repository","agent","user","request","creatorhub","creator","chat","page","context","current","implementation","inspect"}
    result = []
    for word in words:
        if word not in ignored and word not in result:
            result.append(word)
        if len(result) >= 8: break
    return result

def collect_context(repo, objective, repository, priority_paths=None):
    status = run(["git","status","--short"], repo).stdout[-5000:]
    recent = run(["git","log","-8","--oneline","--decorate"], repo).stdout[-5000:]
    tracked = run(["git","ls-files"], repo).stdout.splitlines()
    search_lines, candidate_paths = [], []
    tracked_set = set(tracked)
    for raw in re.findall(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+", objective):
        relative = raw.strip(" `'\".,;:()[]{}")
        if relative in tracked_set and relative not in candidate_paths:
            candidate_paths.append(relative)
    for relative in priority_paths or []:
        if relative in tracked_set and relative not in candidate_paths:
            candidate_paths.append(relative)
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
    deadline = time.monotonic() + LOCAL_REASONING_TIMEOUT_SECONDS
    while True:
        response = httpx.get(
            f"{QUEUE_URL}/api/agents/tasks/llm",
            headers=headers(),
            params={"taskId": task_id, "jobId": job_id},
            timeout=30.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        result = response.json()
        if result.get("status") == "completed":
            return result
        if result.get("status") in {"failed", "cancelled"}:
            raise AgentError(
                result.get("error") or f"Local AI job {result.get('status')}."
            )
        if time.monotonic() >= deadline:
            try:
                httpx.delete(
                    f"{QUEUE_URL}/api/agents/tasks/llm",
                    headers=headers(),
                    params={"taskId": task_id, "jobId": job_id},
                    timeout=30.0,
                    follow_redirects=True,
                )
            except Exception:
                pass
            raise AgentError(
                "Local AI reasoning timed out waiting for available text capacity."
            )
        time.sleep(1.5)

def run_reasoning(task_id, profile, messages, max_tokens, executor_approval=None):
    if isinstance(executor_approval, dict):
        response = post(
            "/api/agents/tasks/paid-llm",
            {
                "taskId": task_id,
                "messages": messages,
                "maxTokens": max_tokens,
                "temperature": 0.1,
            },
            timeout=210.0,
        )
        result = response.json()
        if result.get("status") != "completed":
            raise AgentError(result.get("error") or "Approved stronger-model reasoning did not complete.")
        return {
            "text": result.get("text"),
            "model": result.get("model"),
            "provider": result.get("provider"),
            "promptTokens": result.get("promptTokens"),
            "outputTokens": result.get("outputTokens"),
            "estimatedCostUsd": result.get("estimatedCostUsd"),
            "latencyMs": None,
            "executor": "paid-approved",
        }

    job_id = queue_llm(task_id, profile, messages, max_tokens)
    result = wait_llm(task_id, job_id)
    result["executor"] = "local"
    return result

def system_prompt(agent, mode):
    common = (
        "You are a bounded CoOperative local repo agent. Use supplied repository evidence only. "
        "Do not invent files or state. Prefer deterministic code and existing project patterns. "
        "Never request, reveal, or modify secrets. Never propose production pushes, deployments, "
        "destructive operations, migrations, auth/billing/access-control changes, or arbitrary shell commands. "
        "Preserve working architecture and make the smallest justified change. "
        "Code changes must be portable and reusable for other users whenever possible; do not hard-code one user's identity, "
        "account, business, branch, or temporary workaround when a shared abstraction can solve the same issue safely. "
    )
    if mode in {"prepare_change","update_memory"}:
        return common + (
            "Return ONLY a RAW PLAN using the required delimiters. Do not use JSON or Markdown fences. "
            "Start with <<<SUMMARY>>> then a short summary then <<<END_SUMMARY>>>. "
            "For an existing file, use <<<EDIT path/to/file>>>, then <<<OLD>>> exact existing text "
            "<<<END_OLD>>>, then <<<NEW>>> replacement text <<<END_NEW>>>, then <<<END_EDIT>>>. "
            "For a genuinely new file only, use <<<FILE path/to/file>>> complete contents <<<END_FILE>>>. "
            f"Touch at most {MAX_WRITE_FILES} files. Prefer small exact EDIT blocks over rewriting an existing file. "
            "The OLD block must match repository evidence exactly and uniquely. "
            "If safe work cannot be prepared, return the summary with no edit or file blocks."
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

def _raw_block(value):
    if value.startswith("\n"):
        value = value[1:]
    if value.endswith("\n"):
        value = value[:-1]
    return value

def parse_plan(text):
    summary_match = re.search(r"<<<SUMMARY>>>\s*(.*?)\s*<<<END_SUMMARY>>>", text, re.DOTALL)
    if not summary_match:
        raise AgentError("Local AI did not return the required RAW PLAN summary.")
    edits = []
    pattern = re.compile(
        r"<<<EDIT\s+([^>\n]+)>>>\s*<<<OLD>>>(.*?)<<<END_OLD>>>\s*"
        r"<<<NEW>>>(.*?)<<<END_NEW>>>\s*<<<END_EDIT>>>",
        re.DOTALL,
    )
    for match in pattern.finditer(text):
        edits.append({"path":match.group(1).strip(),"old":_raw_block(match.group(2)),"new":_raw_block(match.group(3))})
    files = []
    for match in re.finditer(r"<<<FILE\s+([^>\n]+)>>>(.*?)<<<END_FILE>>>", text, re.DOTALL):
        files.append({"path":match.group(1).strip(),"content":_raw_block(match.group(2))})
    return {"summary":summary_match.group(1).strip(),"edits":edits,"files":files}

def materialize_plan(repo, raw_plan):
    grouped = {}
    for edit in raw_plan.get("edits") or []:
        if not isinstance(edit, dict):
            raise AgentError("RAW PLAN contains an invalid edit block.")
        relative, old, new = edit.get("path"), edit.get("old"), edit.get("new")
        if not isinstance(relative,str) or not isinstance(old,str) or not isinstance(new,str):
            raise AgentError("RAW PLAN edit fields are invalid.")
        grouped.setdefault(relative, []).append((old,new))
    materialized = []
    for relative, edits in grouped.items():
        path = safe_path(repo, relative)
        if not path.is_file():
            raise AgentError(f"RAW PLAN edit target does not exist: {relative}")
        content = path.read_text(encoding="utf-8")
        for old,new in edits:
            if not old:
                raise AgentError(f"RAW PLAN OLD block is empty for {relative}.")
            count = content.count(old)
            if count != 1:
                raise AgentError(f"RAW PLAN OLD block for {relative} matched {count} times; expected exactly 1.")
            content = content.replace(old,new,1)
        materialized.append({"path":relative,"content":content})
    for item in raw_plan.get("files") or []:
        relative, content = item.get("path"), item.get("content")
        if not isinstance(relative,str) or not isinstance(content,str):
            raise AgentError("RAW PLAN file fields are invalid.")
        path = safe_path(repo, relative)
        if path.exists():
            raise AgentError(f"RAW PLAN used FILE for existing path {relative}; use an EDIT block.")
        materialized.append({"path":relative,"content":content})
    if len(materialized) > MAX_WRITE_FILES:
        raise AgentError("Local AI proposed too many files.")
    return {"summary":str(raw_plan.get("summary") or ""),"files":materialized,"editCount":len(raw_plan.get("edits") or [])}

def parse_plan_with_retry(task_id, profile, messages, llm, text, max_tokens=2400, executor_approval=None):
    try:
        return parse_plan(text), llm, text, False
    except AgentError as first_error:
        progress(task_id, "Local AI returned an invalid RAW PLAN; retrying once for the required delimiters.",
                 kind="format_retry", status="waiting_llm", metadata={"error":str(first_error)[:800]})
        retry_messages = messages + [
            {"role":"assistant","content":text[:10000]},
            {"role":"user","content":"Return the same bounded change using ONLY the required RAW PLAN delimiters. Do not use JSON or Markdown fences. Keep the same scope and prefer small exact EDIT blocks."},
        ]
        retry_llm = run_reasoning(
            task_id,
            profile,
            retry_messages,
            max_tokens,
            executor_approval=executor_approval,
        )
        retry_text = str(retry_llm.get("text") or "")
        try:
            plan = parse_plan(retry_text)
        except AgentError as second_error:
            raise AgentError(f"Local AI returned an invalid RAW PLAN twice. First: {first_error}. Retry: {second_error}") from second_error
        progress(task_id, "Local AI RAW PLAN retry succeeded.", status="running",
                 metadata={"model":retry_llm.get("model"),"latencyMs":retry_llm.get("latencyMs")})
        return plan, retry_llm, retry_text, True

def _diff_counts(original, proposed):
    before = original.splitlines()
    after = proposed.splitlines()
    additions = 0
    deletions = 0
    matcher = difflib.SequenceMatcher(a=before, b=after, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in {"replace", "delete"}:
            deletions += i2 - i1
        if tag in {"replace", "insert"}:
            additions += j2 - j1
    return {
        "originalLines": len(before),
        "proposedLines": len(after),
        "additions": additions,
        "deletions": deletions,
        "changedLines": additions + deletions,
        "deletionRatio": round(deletions / max(1, len(before)), 4),
    }

def _test_path(relative):
    low = relative.lower()
    name = Path(low).name
    return (
        "/tests/" in f"/{low}/"
        or "/test/" in f"/{low}/"
        or "/__tests__/" in f"/{low}/"
        or name.startswith("test_")
        or ".test." in name
        or ".spec." in name
    )

def evaluate_plan_scope(repo, objective, plan):
    files = plan.get("files")
    if not isinstance(files, list):
        return {"blocking": True, "signals": ["Plan has no valid files array."], "metrics": []}

    summary = str(plan.get("summary") or "")
    narrow_request = bool(
        re.search(
            r"\b(smallest|minimal|narrow|bounded|surgical|fix|bug|error|regression)\b",
            objective.lower(),
        )
    )
    metrics = []
    blocking = []
    warnings = []

    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("content"), str):
            blocking.append("Plan contains an invalid file operation.")
            continue
        relative = item["path"]
        path = safe_path(repo, relative)
        original = ""
        if path.exists() and path.is_file():
            try:
                original = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                original = ""
        counts = _diff_counts(original, item["content"])
        counts["path"] = relative
        metrics.append(counts)

        if (
            narrow_request
            and counts["originalLines"] >= 80
            and counts["deletions"] >= 40
            and counts["deletionRatio"] >= 0.30
        ):
            blocking.append(
                f"{relative}: bounded-fix proposal would delete "
                f"{counts['deletions']} of {counts['originalLines']} existing lines "
                f"({counts['deletionRatio']:.0%})."
            )
        if (
            narrow_request
            and counts["originalLines"] >= 80
            and counts["changedLines"] >= max(250, int(counts["originalLines"] * 0.65))
        ):
            blocking.append(
                f"{relative}: bounded-fix proposal changes {counts['changedLines']} lines, "
                "which exceeds the scope guard for a surgical fix."
            )

    if re.search(r"\b(test|tests|tested|testing)\b", summary, re.IGNORECASE):
        changed_paths = [
            item.get("path")
            for item in files
            if isinstance(item, dict) and isinstance(item.get("path"), str)
        ]
        if changed_paths and not any(_test_path(path) for path in changed_paths):
            warnings.append(
                "Proposal summary claims test work, but no dedicated test/spec file is changed."
            )

    signals = []
    for message in blocking + warnings:
        if message not in signals:
            signals.append(message)
    return {
        "blocking": bool(blocking),
        "signals": signals,
        "blockingSignals": blocking,
        "warnings": warnings,
        "metrics": metrics,
        "narrowRequest": narrow_request,
    }

def run_static_file_checks(repo, changed):
    results = []
    for relative in changed:
        path = safe_path(repo, relative)
        suffix = path.suffix.lower()
        if suffix == ".py":
            try:
                ast.parse(path.read_text(encoding="utf-8"), filename=relative)
                results.append({
                    "command": f"python ast.parse {relative}",
                    "passed": True,
                    "skipped": False,
                    "output": "Python syntax parsed successfully.",
                })
            except Exception as exc:
                results.append({
                    "command": f"python ast.parse {relative}",
                    "passed": False,
                    "skipped": False,
                    "output": f"Python syntax check failed: {exc}",
                })
        elif suffix == ".json":
            try:
                json.loads(path.read_text(encoding="utf-8"))
                results.append({
                    "command": f"json parse {relative}",
                    "passed": True,
                    "skipped": False,
                    "output": "JSON parsed successfully.",
                })
            except Exception as exc:
                results.append({
                    "command": f"json parse {relative}",
                    "passed": False,
                    "skipped": False,
                    "output": f"JSON parse failed: {exc}",
                })
    return results

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

def collect_sandbox_candidate_evidence(source_repo, repository, candidates):
    if not isinstance(candidates, list) or not candidates:
        return ""

    branch_base = str(repository.get("defaultBranch") or "main")
    sections = [
        "SUCCESSFUL UNMERGED SANDBOX CANDIDATES:",
        "These are reusable code candidates only. Requester identities and raw chat content are intentionally excluded.",
        "Prefer a proven minimal pattern when it satisfies the current objective, but do not copy unrelated changes.",
    ]

    for candidate in candidates[:5]:
        if not isinstance(candidate, dict):
            continue
        branch = candidate.get("branchName")
        if not _valid_sandbox_branch(branch):
            continue
        fetch = run(
            ["git", "fetch", "origin", branch],
            source_repo,
            timeout=120,
            check=False,
        )
        if fetch.returncode != 0:
            sections.append(f"\nCANDIDATE {branch}: fetch unavailable.")
            continue
        diff_stat = run(
            ["git", "diff", "--stat", f"origin/{branch_base}...origin/{branch}"],
            source_repo,
            timeout=60,
            check=False,
        ).stdout[-5000:]
        diff = run(
            ["git", "diff", "--no-ext-diff", f"origin/{branch_base}...origin/{branch}"],
            source_repo,
            timeout=60,
            check=False,
        ).stdout[-12000:]
        sections.append(
            "\n".join(
                [
                    f"\nCANDIDATE {branch}",
                    f"summary={str(candidate.get('summary') or '')[:800]}",
                    f"changedFiles={json.dumps(candidate.get('changedFiles') or [])[:1600]}",
                    f"commitSha={str(candidate.get('commitSha') or '')[:120]}",
                    "DIFF STAT:",
                    diff_stat,
                    "DIFF:",
                    diff,
                ]
            )
        )

    return "\n".join(sections)[:30000]

def handle_task(task):
    task_id = str(task["taskId"])
    agent, repository = task["agent"], task["repository"]
    mode, objective = str(task["mode"]), str(task["objective"])
    profile = str(task.get("requestedProfile") or agent.get("preferredProfile") or "fast")
    executor_approval = task.get("executorApproval")
    use_paid_executor = isinstance(executor_approval, dict)
    sandbox_base_branch = task.get("sandboxBaseBranch")

    source = ensure_repo(repository)
    progress(task_id, f"Approved repo resolved at {source}.", metadata={"githubRepo":repository["githubRepo"]})
    target, branch = source, None
    if mode in {"prepare_change","update_memory"}:
        target, branch = create_worktree(
            source,
            repository,
            task_id,
            continuation_branch=sandbox_base_branch if mode == "prepare_change" else None,
        )
        progress(
            task_id,
            (
                f"Continued sandbox branch {branch}."
                if sandbox_base_branch
                else f"Created isolated sandbox branch {branch}."
            ),
            branch_name=branch,
            metadata={
                "sandboxBaseBranch": sandbox_base_branch,
                "mergeAllowed": False,
                "ownerReviewRequired": True,
            },
        )
    else:
        update_remote(source, str(repository.get("defaultBranch") or "main"))

    learning_context = task.get("learningContext") or []
    sandbox_candidates = task.get("sandboxCandidates") or []
    priority_paths = []
    if isinstance(learning_context, list):
        for item in learning_context[:3]:
            if not isinstance(item, dict):
                continue
            for relative in item.get("changedFiles") or []:
                if isinstance(relative, str) and relative not in priority_paths:
                    priority_paths.append(relative)

    if isinstance(sandbox_candidates, list):
        for item in sandbox_candidates[:8]:
            if not isinstance(item, dict):
                continue
            for relative in item.get("changedFiles") or []:
                if isinstance(relative, str) and relative not in priority_paths:
                    priority_paths.append(relative)

    context = collect_context(target, objective, repository, priority_paths=priority_paths)
    progress(
        task_id,
        "Repository evidence collected deterministically.",
        metadata={
            "candidateFiles":context["files"],
            "searchTerms":context["terms"],
            "priorityFiles":priority_paths[:10],
            "sandboxCandidates":len(sandbox_candidates) if isinstance(sandbox_candidates, list) else 0,
        },
    )

    checks = []
    if mode == "verify":
        checks = run_checks(target, list(repository.get("checks",[])))
        progress(task_id, "Allowlisted verification checks completed.", metadata={"checks":[{"command":x["command"],"passed":x["passed"]} for x in checks]})

    evidence = context["text"]
    sandbox_evidence = collect_sandbox_candidate_evidence(
        source,
        repository,
        sandbox_candidates,
    )
    if sandbox_evidence:
        evidence += "\n\n" + sandbox_evidence
    if checks:
        check_evidence = []
        for item in checks:
            check_evidence.append(
                f"CHECK {item['command']}: passed={item.get('passed', False)} "
                f"skipped={item.get('skipped', False)}\n{item.get('output', '')}"
            )
        evidence += "\n\nDETERMINISTIC CHECK RESULTS:\n" + "\n\n".join(check_evidence)
    learning_text = ""
    if isinstance(learning_context, list) and learning_context:
        learning_lines = [
            "RECENT HUMAN-DENIED PROPOSALS FOR THIS SAME OWNER/REPOSITORY:",
            "These are negative examples. Do not copy the rejected approach. Use the signals to avoid repeating it.",
        ]
        for item in learning_context[:3]:
            if not isinstance(item, dict):
                continue
            learning_lines.append(
                "\n".join([
                    f"- Prior objective: {str(item.get('objective') or '')[:1200]}",
                    f"  Prior summary: {str(item.get('summary') or '')[:800]}",
                    f"  Rejection signals: {json.dumps(item.get('signals') or [])[:1800]}",
                    f"  Prior diff stat: {str(item.get('diffStat') or '')[:800]}",
                ])
            )
        learning_text = "\n".join(learning_lines)[:6000]

    messages = [
        {"role":"system","content":system_prompt(agent,mode)},
        {"role":"user","content":(f"AGENT: {agent['name']}\nMODE: {mode}\nREPOSITORY: {repository['githubRepo']}\nOBJECTIVE:\n{objective}\n\nREPOSITORY EVIDENCE:\n{evidence[:14000]}")[:16000]},
    ]
    if learning_text:
        messages.append({"role":"user","content":learning_text})
    if len(evidence) > 14000:
        messages.append({"role":"user","content":("ADDITIONAL REPOSITORY EVIDENCE:\n"+evidence[14000:28000])[:16000]})

    progress(
        task_id,
        "Approved stronger-model reasoning requested." if use_paid_executor else "Local AI reasoning requested.",
        status="waiting_llm",
        metadata={
            "executor": "paid-approved" if use_paid_executor else "local",
            "provider": executor_approval.get("provider") if use_paid_executor else None,
            "model": executor_approval.get("model") if use_paid_executor else None,
            "approvedMaxCostUsd": executor_approval.get("approvedMaxCostUsd") if use_paid_executor else None,
        },
    )
    llm = run_reasoning(
        task_id,
        profile,
        messages,
        2400 if mode in {"prepare_change","update_memory"} else 1400,
        executor_approval=executor_approval,
    )
    text = str(llm.get("text") or "")
    progress(
        task_id,
        "Approved stronger-model reasoning completed." if use_paid_executor else "Local AI reasoning completed.",
        status="running",
        metadata={
            "executor": llm.get("executor"),
            "provider": llm.get("provider"),
            "model": llm.get("model"),
            "latencyMs": llm.get("latencyMs"),
            "promptTokens": llm.get("promptTokens"),
            "outputTokens": llm.get("outputTokens"),
            "estimatedCostUsd": llm.get("estimatedCostUsd"),
        },
    )

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

    raw_plan, llm, text, format_recovered = parse_plan_with_retry(
        task_id,
        profile,
        messages,
        llm,
        text,
        2400,
        executor_approval=executor_approval,
    )
    plan = materialize_plan(target, raw_plan)
    guard = evaluate_plan_scope(target, objective, plan)
    if guard["blocking"]:
        progress(
            task_id,
            "Deterministic scope guard rejected the first proposal; retrying with bounded-change feedback.",
            kind="scope_guard_retry",
            metadata={"signals": guard["signals"], "metrics": guard["metrics"]},
        )
        retry_messages = messages + [
            {
                "role": "user",
                "content": (
                    "DETERMINISTIC SCOPE GUARD REJECTED YOUR FIRST PROPOSAL BEFORE ANY FILE WAS WRITTEN.\n"
                    f"First summary: {str(plan.get('summary') or '')[:1200]}\n"
                    f"Signals: {json.dumps(guard['signals'])[:4000]}\n"
                    "Return a corrected RAW PLAN using the required delimiters. Preserve the existing architecture and unrelated behavior. "
                    "For a bug fix, change only the lines/files required by evidence. Do not replace an existing worker "
                    "with a new implementation. If you claim tests, include real test/spec changes or state that tests "
                    "could not be added from the available evidence."
                )[:7000],
            }
        ]
        progress(
            task_id,
            "Approved stronger-model correction requested after scope-guard rejection."
            if use_paid_executor
            else "Local AI correction requested after scope-guard rejection.",
            status="waiting_llm",
        )
        llm = run_reasoning(
            task_id,
            profile,
            retry_messages,
            2400,
            executor_approval=executor_approval,
        )
        text = str(llm.get("text") or "")
        raw_plan, llm, text, scope_format_recovered = parse_plan_with_retry(
            task_id,
            profile,
            retry_messages,
            llm,
            text,
            2400,
            executor_approval=executor_approval,
        )
        format_recovered = format_recovered or scope_format_recovered
        plan = materialize_plan(target, raw_plan)
        guard = evaluate_plan_scope(target, objective, plan)
        progress(
            task_id,
            "Local AI correction completed.",
            status="running",
            metadata={
                "model": llm.get("model"),
                "latencyMs": llm.get("latencyMs"),
                "scopeGuardPassed": not guard["blocking"],
                "signals": guard["signals"],
            },
        )
        if guard["blocking"]:
            complete(
                task_id,
                "failed",
                branch_name=branch,
                error="Deterministic scope guard rejected the corrected proposal; no files were written.",
                result={
                    "summary": plan.get("summary") or "Rejected unsafe/out-of-scope proposal.",
                    "guardRejected": True,
                    "guardSignals": guard["signals"],
                    "guardMetrics": guard["metrics"],
                    "repository": repository["githubRepo"],
                    "worktree": str(target),
                    "model": llm.get("model"),
                    "profile": profile,
                },
            )
            return
    else:
        progress(
            task_id,
            "Deterministic scope guard passed.",
            kind="scope_guard_passed",
            metadata={"signals": guard["signals"], "metrics": guard["metrics"]},
        )

    changed = apply_plan(target, plan, mode=="update_memory", list(repository.get("memoryFiles",[])))
    if changed:
        diff_check = run(["git","diff","--check"], target, check=False)
        checks = [{
            "command":"git diff --check",
            "passed":diff_check.returncode==0,
            "skipped":False,
            "output":diff_check.stdout[-8000:],
        }]
        checks.extend(run_static_file_checks(target, changed))
        if diff_check.returncode == 0:
            checks.extend(run_checks(target, list(repository.get("checks",[]))))
    else:
        checks = []
    diff_stat = run(["git","diff","--stat"], target, check=False).stdout[-12000:]
    diff = run(["git","diff","--no-ext-diff"], target, check=False).stdout[-50000:]

    sandbox_push = {
        "pushed": False,
        "commitSha": None,
        "reason": "not-applicable",
    }
    if mode == "prepare_change" and branch and changed:
        sandbox_push = push_sandbox_branch(
            target,
            branch,
            changed,
            plan.get("summary") or objective,
        )
        progress(
            task_id,
            (
                f"Pushed sandbox branch {branch} for user testing."
                if sandbox_push.get("pushed")
                else f"Sandbox branch {branch} was prepared but could not be pushed."
            ),
            kind="sandbox_branch_pushed" if sandbox_push.get("pushed") else "sandbox_branch_push_failed",
            branch_name=branch,
            metadata={
                "branchName": branch,
                "commitSha": sandbox_push.get("commitSha"),
                "pushed": sandbox_push.get("pushed"),
                "reason": sandbox_push.get("reason"),
                "mergeAllowed": False,
            },
        )

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
        "scopeGuard":guard,
        "learningExamplesUsed":len(learning_context) if isinstance(learning_context, list) else 0,
        "sandboxCandidatesReviewed":len(sandbox_candidates) if isinstance(sandbox_candidates, list) else 0,
        "formatRecovered":format_recovered,
        "planFormat":"raw-edit-v1",
        "editCount":plan.get("editCount", 0),
        "evidenceFiles":context["files"],
        "executor": llm.get("executor"),
        "provider": llm.get("provider"),
        "estimatedCostUsd": llm.get("estimatedCostUsd"),
        "executorApproval": executor_approval if use_paid_executor else None,
        "sandbox": {
            "branchName": branch,
            "baseBranch": sandbox_base_branch,
            "continued": bool(sandbox_base_branch),
            "pushed": sandbox_push.get("pushed"),
            "commitSha": sandbox_push.get("commitSha"),
            "pushReason": sandbox_push.get("reason"),
            "mergeAllowed": False,
            "ownerReviewRequired": True,
            "minimalChangeRequired": True,
            "portableForOtherUsersRequired": True,
        } if mode == "prepare_change" else None,
    })

def local_node_available():
    if not NODE_ID:
        return True
    try:
        from unison_runtime import node_available
        return bool(node_available())
    except Exception:
        # Fail closed for installed Unison nodes if idle state cannot be verified.
        return False

def queue_loop():
    print(f"CoOperative repo agent polling enabled for {QUEUE_URL} as {WORKER_ID}.")
    print(f"Approved workspace root: {WORKSPACE_ROOT}")
    if NODE_ID:
        print(f"Owner-scoped Unison Recovery Agent enabled for node {NODE_ID}.")
        print("Recovery work claims only while the node is eligible under its local idle policy.")
    print("Agent writes use isolated local worktrees; push/deploy remain human-gated.")
    while True:
        task_id = None
        try:
            if NODE_ID and not local_node_available():
                time.sleep(POLL_SECONDS)
                continue
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
        raise AgentError("A local worker or Unison node token is required.")
    if shutil.which("git") is None:
        raise AgentError("Git is required for Recovery Agent repository repair.")
    queue_loop()
