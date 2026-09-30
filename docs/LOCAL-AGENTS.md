# Local Agent Runtime v1

CoOperative agents are bounded roles that combine deterministic repository tooling with the existing local LLM queue.

## v1 agents

- **Repo Engineer** — inspect an approved repo or prepare a bounded source/doc change.
- **Project Memory** — inspect or update only explicitly approved memory files.
- **Debugger** — inspect failures and prepare a bounded fix.
- **Verifier** — independently inspect repository state and run allowlisted checks without writing files.

## Approved repositories

Initial registry:
- `zanibethel/CoOperative`
- `zanibethel/CreatorHub`

The local worker resolves repos beneath `COOPERATIVE_AGENT_WORKSPACE_ROOT`. If not set, it uses the parent directory of the current CoOperative checkout. Missing approved repos may be cloned from GitHub.

## Safety boundary

The local repo worker:
- never receives unrestricted shell text from the model;
- exposes only deterministic Git/file/check operations implemented in code;
- blocks env files, keys/certificates, dependency/vendor directories, Git internals, migrations, auth/billing/credential paths, and package lock files from prepared writes;
- never deletes files in v1;
- never pushes, merges, deploys, publishes, installs dependencies, or changes production resources;
- creates `agent/<task-id>` branches in isolated Git worktrees for prepared writes;
- leaves prepared changes at `needs_approval` even when checks pass.

## Code-first loop

1. Claim a persistent agent task through outbound polling.
2. Resolve and validate the approved repo and Git remote.
3. Gather repo status, history, tracked-file tree, keyword matches, and relevant file contents deterministically.
4. Run allowlisted checks directly when the task is verification.
5. Queue a local text job only when synthesis/reasoning/code generation is needed.
6. Validate any proposed file operations in code.
7. Apply safe writes only inside an isolated local worktree.
8. Run `git diff --check` plus repository-specific allowlisted checks.
9. Return analysis/diff/check evidence to the authenticated Agents UI.
10. Require human review before any future push/deploy step.

## Local processes

The agent runtime is intentionally split:

- `workers/mlx-text-worker.py` owns local MLX inference.
- `workers/repo-agent-worker.py` owns deterministic repo access and queues local LLM reasoning through CoOperative.

This prevents the repo worker from loading a second copy of the model into the 16 GB M1 memory pool.

## Current repository checks

- CoOperative: `npm run build`
- CreatorHub: `npm run build`

The worker may reuse an existing `node_modules` directory through an isolated-worktree symlink. It does not automatically install dependencies.

## Memory files

CoOperative:
- `docs/ai/OWNER_PROFILE.md`
- `docs/ai/AGENT_POLICY.md`
- `docs/ai/CURRENT_STATE.md`
- `docs/ai/DECISIONS.md`
- `docs/ai/LESSONS.md`

CreatorHub:
- `docs/AI_CONTEXT.md`
- `docs/DECISIONS.md`
- `docs/CURRENT_STATE.md`

The Project Memory agent is limited to these files in v1.
