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


---

## 2026-09-18T00:16:29-05:00 — Telegram cutover deferred; Owner Console self-bootstrap remains next

**Scope:** Cloud Operative / Issue #4 / Telegram

**Owner intent:** Continue toward a Mac-independent Cloud Operative while minimizing Hermes spend and keeping ChatGPT as the primary orchestration/review layer.

**Changes / decisions:**
- Gate 1 remains complete.
- Telegram `setWebhook` is explicitly deferred.
- Review found the current webhook is inbound-only: it can authenticate and persist Telegram messages but cannot yet send advisor/task responses back.
- No Telegram identity is currently linked/allow-listed in `channel_identities`.
- The next functional target is Owner Console → durable task → policy/executor → cloud execution → Decision Brief/approval → resume → result/evidence, tested with the Mac offline.
- `SUPABASE_SECRET_KEY` is the next relevant server-side secret for trusted Cloud Operative writes.
- `TELEGRAM_WEBHOOK_SECRET` and future outbound `TELEGRAM_BOT_TOKEN` are deferred until the Telegram secondary-channel path is complete.

**Why:** Cutting over Telegram now would replace a working long-polling bot with an inbound-only cloud path and would not satisfy Issue #4's actual success definition. Finishing the Owner Console cloud flow first avoids wasted effort and unnecessary Hermes/token spend.

**Affected areas:** Cloud Operative sequencing, Vercel secrets, Telegram, Owner Console, Hermes usage, Issue #4 and PR #5.

**Conflict / supersession notes:** Supersedes the earlier simplistic remaining-gates sequence that treated Telegram secret setup and `setWebhook` as the immediate next steps after Gate 1. It does not change Telegram's intended long-term role as a secondary interface.

**Source:** Post-Gate-1 ChatGPT review of live Supabase state and current PR #5 implementation.

**Status:** Active current sequence.


---

## 2026-09-18T00:31:22-05:00 — First governed Owner Console / Mission Control slice built

**Scope:** Cloud Operative / Owner Console / Issue #4 / PR #5

**Owner intent:** Continue building the Mac-independent Cloud Operative primarily through ChatGPT/connected tooling, using Hermes only when shell/runtime/autonomous capability is genuinely required.

**Changes / decisions:**
- Added a phone-friendly Owner Console on the `cloud-operative-bootstrap` draft branch.
- Added canonical conversation overview, recent operative tasks, pending Decision Briefs, task risk/cost state, and read-only evidence APIs.
- Added deterministic task-safety policy flags for shell/runtime, production, secrets, database/RLS, money movement, and destructive actions.
- Added governed task creation through a trusted server-only path; it fails closed until `SUPABASE_SECRET_KEY` is explicitly configured.
- Owner-gated tasks now deterministically create a Decision Brief, move to `awaiting_approval`, append the brief to the canonical conversation, and do not execute.
- Added authenticated approve/reject/modify/ask-question handling. Responses are written into canonical conversation/task audit state, but approval intentionally does **not** resume execution yet.
- Expanded CI so every PR now runs unit tests, explicit TypeScript checking, lint, and build rather than relying on Hermes/manual verification for those basics.
- Final branch verification passed all four checks.

**Why:** The owner wants CoOperative to become the persistent control surface between ChatGPT, cloud execution/Hermes, projects, decisions, and memory without requiring the Mac. Building canonical task/decision state and self-verifying CI first reduces paid-agent rediscovery and preserves owner gates before cloud execution is connected.

**Affected areas:** Owner Console, task policy, operative task API, Decision Brief flow, audit trail, CI, future Cloud Operative executor and ChatGPT bridge.

**Conflict / supersession notes:** Consistent with the prior decision to finish Owner Console self-bootstrap before Telegram cutover. Telegram remains deferred. This also preserves the ChatGPT-first / Hermes-only-when-needed executor split.

**Current boundary:** No production secret was set, no production authority was expanded, no Telegram cutover occurred, and no cloud executor was connected. `SUPABASE_SECRET_KEY` remains the next explicit owner gate required to exercise trusted task/decision writes in the deployed Cloud Operative.

**Source:** Owner-authorized ChatGPT implementation and GitHub/Vercel CI verification.

**Status:** Repo-side Phase C control-surface slice complete on draft PR #5; trusted runtime/executor connection pending.


---

## 2026-09-18T00:37:38-05:00 — First cloud execution proof defined as deterministic playbook, not Hermes reasoning

**Scope:** Cloud Operative / Vercel Sandbox / executor routing / Issue #4

**Owner intent:** Keep ChatGPT as the primary planning/implementation connection, use paid Hermes reasoning only when genuinely necessary, and turn repeatable operations into code/playbooks so future execution becomes cheaper.

**Changes / decisions:**
- Added an allow-listed `cloud-self-check` playbook. Owner conversation text can never become arbitrary shell commands.
- The playbook checks out the exact CoOperative revision in Vercel Sandbox, confirms the revision/runtime, installs dependencies, and runs the repository unit tests.
- Added a governed execution endpoint that verifies owner scope, approved playbook, task state, and any required owner approval before execution.
- The first cloud self-check records `deterministic-code` as the executor and `vercel-sandbox` separately as the execution runtime; Hermes/model reasoning is not used.
- Execution follows the canonical task state machine: `queued -> planning -> executing -> verifying -> completed` for the safe self-check, with failures recorded as task/audit evidence.
- Sandbox output persisted to task results is deliberately bounded to avoid storing excessive logs.
- The cost ledger records direct per-task marginal cash cost separately from allocated platform/quota cost so included infrastructure is not confused with permanently free infrastructure.
- Added a one-click Cloud self-check control to the Owner Console for the eventual Mac-offline proof.
- CI initially caught a safety-flag type normalization issue; it was corrected before runtime.
- Final CI passed unit tests, TypeScript, lint, and build; Vercel preview for the corrected head is READY.

**Why:** The first proof of cloud execution should demonstrate the architecture itself: known work runs from a reviewed deterministic playbook in an isolated cloud workspace, with AI/Hermes reserved for problems that actually require reasoning.

**Affected areas:** Playbook registry, Cost Governor evidence, executor selection, Vercel Sandbox adapter, Owner Console, operative task state machine, self-bootstrap test.

**Conflict / supersession notes:** Clarifies earlier language that could imply Vercel Sandbox work should be labeled as `hermes-cloud-operative`. For deterministic reviewed commands, the executor is deterministic code; Sandbox is the runtime. Hermes remains available for reasoning/autonomous work that cannot be reduced to a known playbook.

**Current boundary:** The self-check code is ready but has not been executed against live trusted task state because `SUPABASE_SECRET_KEY` is still unset and remains an explicit owner gate.

**Source:** Owner-authorized ChatGPT implementation, GitHub Actions verification, and Vercel preview verification.

**Status:** Implementation ready on draft PR #5; live Mac-offline self-check pending server-secret approval/configuration.


---

## 2026-09-18 — Cloud Hermes model selection becomes a CoOperative routing concern

**Scope:** Cloud Operative / Hermes / AI Router / ChatGPT + Telegram interfaces

**Owner intent:** Avoid manually switching Hermes models on the Mac once cloud execution is operational. Model choice should be available through normal CoOperative interfaces and should usually happen automatically based on cost, capability, availability, and task requirements.

**Changes / decisions:**
- The current local Hermes model picker is treated as a temporary bootstrap control, not the desired production workflow.
- CoOperative should select the model **before invoking Hermes** whenever possible, using the task's required capability, risk, quality floor, budget, latency, and currently available/priced models.
- Known deterministic/playbook work should bypass Hermes/model selection entirely.
- If the selected model is unavailable (for example HTTP 503 / provider pricing unavailable), the router should fall back to the next approved qualified model instead of repeatedly retrying the same unavailable model.
- Hermes may request escalation when the assigned model cannot complete the task, but any material increase in cost/risk remains subject to Cost Governor and owner policy.
- ChatGPT, Telegram, and Owner Console should all be able to express optional overrides such as "cheapest qualified model", "use a stronger model", or a task spend cap; these become task constraints in the same canonical system rather than channel-specific settings.
- The default experience should hide provider/model details unless the owner asks to inspect or override them.

**Why:** Model/provider choice is infrastructure. The owner should interact with tasks and business outcomes, while CoOperative minimizes cost and avoids failures caused by stale/unavailable model defaults.

**Affected areas:** AI Router, Cost Governor, Cloud Operative task contract, Hermes invocation, Owner Console, Telegram adapter, future ChatGPT bridge.

**Conflict / supersession notes:** Reinforces the existing provider-independent AI architecture and lowest-marginal-cost executor policy. It supersedes any assumption that a single Hermes-wide default model should control every cloud task.

**Source:** Owner conversation in ChatGPT after local Hermes model availability failure.

**Status:** Active architecture decision.
