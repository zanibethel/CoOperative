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


## Service-agent runtime

Customer-facing agents are purpose-specific services, not general autonomous bots. Deterministic application code selects a capability first and calls the corresponding service agent only when that capability is needed.

Each service agent declares:

- one bounded purpose;
- the capabilities it may provide;
- which persistence scopes it may read and write;
- its default execution mode;
- whether local, community, or paid AI escalation is allowed.

The runtime must prefer ordinary code for routing, validation, state inspection, simple parsing, and known workflow transitions. An AI call is justified only when the remaining step requires interpretation, generation, planning, or ambiguity resolution that deterministic code cannot safely provide.

### Persistence contract

Conversation history is not the canonical database for durable business facts. Agents should persist supported information into structured state with provenance.

For each persisted fact, preserve enough metadata to distinguish:

- user-provided facts;
- imported/provider facts;
- deterministic derivations;
- AI interpretations;
- confidence when interpretation was required;
- which agent/capability wrote the value;
- when it was updated;
- the conversation or workflow that supplied it when relevant.

An agent must not persist unrelated details merely because they appeared in conversation. Raw conversation remains history; durable profile facts, workflow state, and artifacts are separate concerns.

The first conversational-intake implementation stores fact provenance alongside the business profile under CoOperative-owned metadata. This keeps the feature deployable without a new database migration while preserving a clean future path to normalized fact tables.

### Code-first conversational intake

Business intake should behave like a conversation without requiring an LLM for every turn.

The current baseline flow:

```text
message
  -> inspect selected business + saved intake state
  -> determine whether business-intake capability applies
  -> select next missing field
  -> parse/save straightforward answer in code
  -> record provenance
  -> ask next question
  -> fall through to AI routing only when intake does not apply
```

Do not ask for information that is already saved unless a workflow specifically needs confirmation that it changed.
