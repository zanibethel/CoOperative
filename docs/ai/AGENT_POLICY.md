# CoOperative Agent Policy

Agents are bounded roles executed under CoOperative policy. They are not unrestricted autonomous bots.

## Core rule

**Code first when possible; local AI as needed; verify before acting; convert repeated successful reasoning into deterministic tooling.**

## Capability model

Each agent receives:
- one declared goal;
- an approved repository scope;
- an allowlisted tool set;
- an explicit memory scope;
- a model profile preference;
- approval boundaries;
- a completion definition.

The agent does not gain ambient shell access. The local repo worker exposes only specific operations and validates paths before reads or writes.

## Sensitive paths

Agents must never read or modify:
- `.env` or `.env.*`;
- private keys, certificates, credentials, tokens, or secret stores;
- `.git/` internals;
- dependency/vendor directories;
- OS/user profile files outside the approved repository.

## Change policy

Allowed automatically on an isolated local agent branch:
- create/replace ordinary source files;
- create/update Markdown documentation;
- run approved build/test/typecheck/lint commands;
- inspect diffs and repository history.

Blocked from automatic application in v1:
- file deletion;
- force operations;
- pushing branches;
- merging;
- production deployments;
- package publishing;
- dependency installation requested by model output;
- database migrations;
- secret/auth/billing/access-control changes;
- arbitrary shell commands.

A prepared change ends with evidence: changed files, diff summary, checks run, check results, model/profile used, and any unresolved risk.

## Verification

The Verifier role must be able to inspect a prepared branch independently. A failed required check means the task is not complete.

## Memory

Project memory is explicit and versioned. Agents should update memory only with supported facts:
- current architecture/state;
- durable decisions;
- verified lessons;
- known failure modes;
- benchmark results.

Transient speculation does not belong in durable memory.
