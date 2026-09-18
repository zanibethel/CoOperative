# CoOperative Owner Intent & Change Audit

## Purpose

This is the chronological, human-readable audit trail of meaningful owner direction, product vision changes, major implementation decisions, and consequential project updates.

It exists to prevent:

- restarting work that was already designed or started elsewhere;
- building duplicate capabilities under different names;
- accidentally contradicting an earlier owner decision;
- losing the reason a feature or policy exists;
- treating an old decision as current after the owner changes direction.

This file complements structured CoOperative memory. It does not replace Git history, task events, pull requests, or the future canonical conversation store.

## Operating rule

After a meaningful conversation about CoOperative's vision, future direction, architecture, operating policy, managed projects, or significant implementation changes, append a concise entry here.

Before proposing or beginning substantial work:

1. Read the latest relevant entries.
2. Compare the request with existing decisions and features.
3. Reuse or extend existing work when possible.
4. If the new request conflicts with a prior active direction, surface the conflict.
5. If the owner explicitly changes direction, preserve the old entry and mark the newer decision as superseding it rather than rewriting history.

Do not log routine chatter, tiny wording edits, or low-value implementation noise.

## Entry format

Each entry should contain:

- **Timestamp**
- **Scope**
- **Owner intent**
- **Changes / decisions**
- **Why**
- **Affected areas**
- **Conflict / supersession notes**
- **Source**
- **Status**

---

## 2026-09-18T00:09:55-05:00 — Persistent owner-intent audit becomes a standing operating requirement

**Scope:** CoOperative platform / all managed projects

**Owner intent:** Preserve meaningful conversations about vision, future direction, and current project changes directly in the repository so future work can recover prior intent without requiring the owner to restate it.

**Changes / decisions:**
- Establish this append-only Owner Intent & Change Audit.
- Meaningful project/vision conversations should produce a short dated audit entry.
- Future planning and implementation should check relevant prior entries before creating overlapping or contradictory work.
- If a new request contradicts an earlier feature or decision, identify the conflict before proceeding.
- Preserve historical decisions and record explicit supersession rather than silently editing history.

**Why:** The owner wants continuity across ChatGPT, Hermes, CoOperative, and future channels. Repository-visible intent provides a durable bridge until the canonical conversation/memory system is fully operational and remains useful afterward for human review.

**Affected areas:** Owner workflow, ChatGPT orchestration, Hermes task intake, memory/retrieval, project planning, managed-project improvements.

**Conflict / supersession notes:** This strengthens the existing Memory & Preference Engine and does not replace it. The audit is chronological evidence; structured memory remains the selective machine-readable context layer.

**Source:** Owner conversation in ChatGPT.

**Status:** Active standing policy.

---

## 2026-09-18T00:09:55-05:00 — Owner-orchestrated executor split confirmed

**Scope:** CoOperative execution economics

**Owner intent:** Use ChatGPT as the primary connection and implementation/review layer when it can safely perform the work; use Hermes only when its shell, autonomous, persistent, cloud-runtime, or specialized capabilities are actually needed.

**Changes / decisions:**
- ChatGPT completes qualified lower-marginal-cost work first.
- Hermes receives the smallest necessary remaining capability gap.
- Hermes task briefs remain narrow but complete enough to avoid expensive rediscovery.
- Additional Hermes credit balance increases available capacity but does not justify duplicated work.

**Why:** Preserve Hermes credits for useful compute while maintaining thoroughness and execution quality.

**Affected areas:** Cost Governor, executor routing, Cloud Operative, Hermes operating contract.

**Conflict / supersession notes:** Consistent with the existing playbook-first and lowest-qualified-cost executor policies.

**Source:** Owner conversation in ChatGPT.

**Status:** Active.

---

## 2026-09-18T00:09:55-05:00 — RaiseHub selected as first managed-project improvement pilot

**Scope:** Managed Projects / RaiseHub

**Owner intent:** Connect RaiseHub to CoOperative so CoOperative can learn from, analyze, and improve the project without merging RaiseHub into the CoOperative codebase.

**Changes / decisions:**
- RaiseHub is the first real Managed Project pilot.
- Initial operating mode is Observe + Propose + PR-only.
- CoOperative should analyze cost, reliability, development efficiency, business growth, and opportunities to replace unnecessary AI with deterministic logic.
- Production database writes, financial-impact changes, destructive operations, and broad assisted editing remain owner-gated while RaiseHub's development and production Supabase environments are not fully separated.
- Successful improvements should be measured and promoted into reusable CoOperative playbooks.

**Why:** RaiseHub provides a real project with existing architecture, business workflows, infrastructure, and measurable outcomes, making it a strong proving ground for CoOperative's Improvement Engine.

**Affected areas:** Managed Projects, Improvement Engine, RaiseHub connector/adapter, executor routing, evidence/playbook learning.

**Conflict / supersession notes:** Does not replace the Square Connector Factory pilot; this is a separate managed-project/improvement pilot.

**Source:** Owner conversation in ChatGPT.

**Status:** Active pilot.


---

## 2026-09-18T00:12:00-05:00 — Cloud Operative Gate 1 database migration applied and independently verified

**Scope:** Cloud Operative / Supabase / Issue #4

**Owner intent:** Proceed with the reviewed Cloud Operative v0.2 database foundation, but stop before secret configuration, Telegram webhook cutover, or other later gates.

**Changes / decisions:**
- Owner explicitly approved Gate 1 only.
- Versioned migration `20260918044018_cloud_operative_v0_2` was applied to the linked CoOperative Supabase project.
- The 8 Cloud Operative tables now exist: conversations, conversation_messages, operative_tasks, task_events, decisions, cost_ledger_entries, memories, and channel_identities.
- Independent post-apply verification confirmed RLS enabled on all 8 tables.
- Supabase security advisor returned no lints.
- Hermes stopped before Gate 2 and Gate 3 as instructed.

**Why:** Establish the durable conversation/task/decision/memory/cost/channel foundation required for cloud execution while preserving owner control over secrets and live Telegram cutover.

**Affected areas:** Supabase schema, Cloud Operative, canonical memory/conversation state, future ChatGPT/Telegram/Owner Console bridge.

**Conflict / supersession notes:** No conflict. This advances the existing Cloud Operative self-bootstrap plan. Production secret configuration and Telegram `setWebhook` remain unapproved.

**Verification notes:** Supabase performance advisor currently reports informational findings, including unindexed foreign-key coverage on several new composite relationships and unused indexes on newly created/unused tables. These are performance-tuning items, not current security failures, and should be addressed based on measured query patterns rather than by reflexively adding/removing indexes.

**Source:** Owner-approved Hermes Gate 1 execution plus independent ChatGPT/Supabase verification.

**Status:** Gate 1 complete. Gate 2 and Gate 3 pending.
