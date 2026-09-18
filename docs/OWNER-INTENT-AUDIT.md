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


---

## 2026-09-18 — Preview-only trusted Supabase server secret configured; Cloud self-check ready to run

**Scope:** Cloud Operative / Vercel Preview / server-only Supabase access

**Owner intent:** Enable the minimum trusted backend authority needed to exercise Cloud Operative task/audit writes without promoting the secret to Production or touching Telegram.

**Changes / decisions:**
- `SUPABASE_SECRET_KEY` was configured for the Vercel **Preview** environment only for the `cloud-operative-bootstrap` branch.
- Production was not given the secret.
- Telegram secrets were not configured and Telegram `setWebhook` was not called.
- The latest `cloud-operative-bootstrap` preview was redeployed after the secret change.
- Independent Vercel verification confirmed deployment `dpl_93QQpbtTAeDpzigszH6JSqxbfRPA` is READY at `co-operative-l4wqflb6h-zanibethels-projects.vercel.app`.
- The deployment is tied to commit `6a370d59867494ab82c9feccca790b2829856ebc`, the corrected Cloud self-check/state-machine implementation.
- The next intended action is to open the Owner Console from a phone and run the allow-listed Cloud self-check, proving the task can execute in Vercel Sandbox without the Mac participating in runtime.

**Why:** This is the smallest live authority increase needed to test the trusted Cloud Operative path while keeping production and Telegram unchanged.

**Affected areas:** Vercel Preview environment, trusted Supabase server writes, Owner Console, Cloud self-check, Mac-offline bootstrap proof.

**Conflict / supersession notes:** Consistent with the prior Preview-only secret gate and Telegram deferral. Does not authorize Production secret promotion or broader Cloud Operative authority.

**Source:** Owner-approved Hermes secret plumbing plus independent ChatGPT/Vercel deployment verification.

**Status:** Preview runtime gate complete; first live Cloud self-check pending.


---

## 2026-09-18 — Owner Console login redirect fixed

**Scope:** Cloud Operative / Owner Console / Preview authentication flow

**Owner intent:** Opening the Owner Console should take the owner back to the console after authentication, not restart the Intelligence Report/intake workflow.

**Changes / decisions:**
- Found that `/console` correctly redirected unauthenticated users to `/login?next=/console`, but the login page ignored the `next` parameter and always sent successful sign-ins to `/onboarding`.
- Existing-workspace onboarding then redirected to `/intake`, which made the owner see the older Intelligence Report flow instead of Cloud self-check/Mission Control.
- Updated login/signup handling to preserve and honor the requested `next` route.
- New Preview deployment is READY and available through the stable `cloud-operative-bootstrap` branch alias.

**Why:** Authentication should preserve user intent and route continuity. The old behavior made a working Owner Console appear missing and could restart an unrelated workflow.

**Affected areas:** Login flow, Owner Console navigation, Cloud self-check bootstrap proof.

**Conflict / supersession notes:** No product-direction conflict; this corrects routing behavior to match the existing Owner Console design.

**Source:** Owner report from phone testing plus ChatGPT code review.

**Status:** Fixed in Preview.


---

## 2026-09-18 — CoOperative Platform Owner Console will adopt RaiseHub's owner-operations pattern

**Scope:** Platform owner access / Owner Console / Managed Projects / Support

**Owner intent:** Reuse the successful RaiseHub Owner Dashboard/Platform Console approach for CoOperative so the platform owner has powerful direct operational tooling without confusing that access with ordinary customer/business Owner Console permissions.

**Changes / decisions:**
- CoOperative will distinguish a tenant/business Owner Console from a separate Platform Owner Console.
- Platform-owner identity remains permanent while selecting organizations, customers, or managed projects; context switching must not impersonate the subject.
- Platform support/inspection begins read-only.
- Privileged editing/operations must be explicitly enabled, scoped, reasoned, policy-checked, and audited.
- Platform Owner tooling should eventually include managed projects, organizations, Mission Control, AI/executor routing, connectors, costs/economics, audit/memory, support, deployments/incidents, and platform settings.
- Platform authorization should be tied to authenticated user IDs/roles/capabilities rather than a hard-coded owner email.
- High-risk production/auth/RLS/database/secrets/money/destructive actions retain stronger owner gates.
- RaiseHub is the reference implementation pattern, not a codebase to merge into CoOperative.

**Why:** RaiseHub has already demonstrated a useful model for permanent owner identity, workspace browsing, read-only support, explicit editing, role preview, and auditability. Reusing those principles reduces duplicate design work and keeps CoOperative's privileged access understandable and governable.

**Affected areas:** Authentication/authorization roadmap, Owner Console architecture, Managed Projects, support tooling, audit, future internal roles.

**Conflict / supersession notes:** Clarifies the earlier Owner Console work: `/console` remains the tenant/business operating surface. A separate platform-level owner surface should be introduced rather than giving all authenticated workspace owners platform-wide privileges.

**Source:** Owner conversation in ChatGPT after reviewing the RaiseHub Owner Platform pattern.

**Status:** Active architecture direction; auth/RLS/schema implementation still requires explicit owner approval.


---

## 2026-09-18 — Preview Supabase server key corrected after live Owner Console test

**Scope:** Cloud Operative / Vercel Preview / Supabase trusted server access

**Owner intent:** Make the Preview-only trusted Cloud Operative path actually usable without widening authority to Production or Telegram.

**Changes / decisions:**
- First phone test confirmed the Owner Console and normal user-scoped Supabase path worked, but trusted task creation failed with `Invalid API key`.
- The failure was isolated to the Preview `SUPABASE_SECRET_KEY`; canonical owner messages still persisted successfully through the normal authenticated/RLS path.
- Hermes used the authenticated Supabase CLI to inspect API keys for the exact CoOperative project ref `hbgyebthxmgbuoqadelb`, selected the valid current server-side secret key, and replaced the Vercel Preview-only value.
- No secret value was exposed in repository/chat output.
- Production and Telegram configuration remained unchanged.
- Vercel redeployed the `cloud-operative-bootstrap` Preview.
- Independent verification confirmed deployment `dpl_9givJ4ys9GJQPnx4vthG6kmVWaou` is READY at `co-operative-k33kl8irl-zanibethels-projects.vercel.app`, commit `78f7db48ad90b0097ffe5792edfa05fc8f7e0fd2`.

**Why:** The first Preview secret value was not accepted by Supabase. Correcting the exact project key restores the intended trusted backend path while preserving the smallest-authority Preview-only test boundary.

**Affected areas:** Owner Console governed task creation, trusted Supabase admin client, Cloud self-check.

**Conflict / supersession notes:** Supersedes the previously configured invalid Preview secret value only. Does not authorize Production promotion, Telegram cutover, or broader server authority.

**Source:** Owner phone test, Hermes key correction, and independent ChatGPT/Vercel verification.

**Status:** Corrected Preview is READY; rerun Cloud self-check next.


---

## 2026-09-18 — First live Cloud self-check reached Sandbox; Git metadata assumption corrected

**Scope:** Cloud Operative / Vercel Sandbox / Owner Console bootstrap proof

**Owner intent:** Prove that a phone-triggered CoOperative task can execute in the cloud without the Mac or Hermes model reasoning.

**Changes / decisions:**
- The second live phone self-check successfully passed canonical message persistence, governed task creation, deterministic policy evaluation, task state transitions, executor selection, Vercel Sandbox startup, cost/evidence recording, and Sandbox shutdown.
- Execution failed only on the first allow-listed playbook command: `git rev-parse HEAD` returned exit code 128 because the Vercel Sandbox Git source did not expose a usable `.git` repository in the working directory.
- The task correctly recorded `failed`, persisted the failing command/result, and retained a $0 direct marginal-cost ledger entry for the test.
- The self-check was corrected to validate the staged project by checking for `package.json` rather than depending on Git metadata that the Sandbox source does not guarantee.
- The deployment SHA remains recorded separately from the Vercel deployment environment and is passed as the requested source revision.
- Corrected Preview deployment `dpl_DRGRSXkYyPz2yQAf1SNaxrCvv37q` is READY at `co-operative-4aposmg2m-zanibethels-projects.vercel.app`.

**Why:** The bootstrap proof should verify the actual runtime artifact, not make assumptions about implementation details of Vercel Sandbox source staging.

**Affected areas:** Cloud self-check playbook, Sandbox verification, task evidence.

**Conflict / supersession notes:** Supersedes the earlier self-check assertion that `git rev-parse HEAD` is a valid verification step inside Vercel Sandbox. The overall deterministic-playbook architecture remains unchanged.

**Source:** Owner phone test plus persisted task/event evidence and Vercel runtime verification.

**Status:** Fix deployed to Preview; retest pending.


---

## 2026-09-18 — Vercel Sandbox seeded Git source requires repository cwd

**Scope:** Cloud Operative / Vercel Sandbox adapter / bootstrap self-check

**Owner intent:** Continue the phone-triggered Mac-independent cloud execution proof and retain runtime lessons so repeated tasks do not rediscover the same issue.

**Changes / decisions:**
- The corrected self-check reached Vercel Sandbox again but `test -f package.json` failed from the default Sandbox working directory.
- Persisted task evidence confirmed the task pipeline itself remained healthy: task created, `queued -> planning -> executing`, deterministic executor selected, Sandbox started/stopped, failure evidence recorded.
- Vercel's official Sandbox SDK example confirms that Git-seeded sources are checked out into a directory named for the repository and commands should specify that directory via `cwd`.
- Updated the Sandbox adapter to derive the repository directory from `repoSlug` and run every allow-listed playbook command with that `cwd`.
- This keeps repository-location knowledge inside the reusable Sandbox adapter rather than individual playbooks.
- Corrected Preview deployment `dpl_7R1fcfifyFafHycHW5hEvnw2V7Vk` reached READY at `co-operative-h0zuftplg-zanibethels-projects.vercel.app`.
- CI unit tests, typecheck, and lint passed; final build verification was still running when this entry was written.

**Why:** A shared execution adapter should normalize provider-specific workspace layout so future playbooks can assume they execute from the project root.

**Affected areas:** Vercel Sandbox adapter, deterministic playbooks, future cloud executors.

**Conflict / supersession notes:** Supersedes the earlier assumption that seeded Git source executes from the Sandbox default working directory. The deterministic-playbook architecture remains unchanged.

**Source:** Owner phone test, persisted task evidence, and current Vercel Sandbox SDK documentation.

**Status:** Adapter fix deployed to Preview; final CI build check pending before retest.


---

## 2026-09-18 — First Mac-independent Cloud Operative self-check completed successfully

**Scope:** Cloud Operative / Owner Console / Vercel Sandbox / Issue #4

**Owner intent:** Prove that CoOperative can accept a task from the phone, execute reviewed work in the cloud, persist evidence/cost/state, and complete without the Mac or Hermes model reasoning participating in runtime.

**Changes / decisions:**
- The live `cloud-self-check` task completed successfully.
- Task state progressed through `queued -> planning -> executing -> verifying -> completed`.
- Executor was recorded as `deterministic-code`; runtime was Vercel Sandbox.
- The Sandbox successfully verified the project artifact, reported Node `v24.21.0`, installed dependencies, and ran the full unit test suite.
- All 39 unit tests passed in the cloud Sandbox.
- Sandbox runtime was approximately 16.4 seconds.
- Direct per-task marginal cash cost recorded in CoOperative was $0; allocated Vercel platform/quota cost remains a separate economics concern.
- This constitutes the first successful proof that the Mac is not required for this deterministic cloud execution path.
- Immediately afterward, the owner queued a real low-risk task: `Check out raisehub.app and let me know if there are any improvements I could make`.
- That task has a maximum spend cap of $0.50, current actual spend $0, low risk, and remains `queued` with no executor/playbook selected yet.

**Why:** This validates the core Cloud Operative architecture before adding broader autonomous routing: phone -> canonical task -> policy -> deterministic executor -> cloud Sandbox -> verification -> evidence/result.

**Affected areas:** Owner Console, Cloud Operative, task state machine, Vercel Sandbox, Cost Governor, Managed Projects / RaiseHub pilot.

**Conflict / supersession notes:** Supersedes the earlier bootstrap-test failures as the current validated state. It does not yet prove generic queued tasks can autonomously select an AI/Hermes executor; that routing layer remains the next capability gap.

**Source:** Owner phone execution plus independently queried Supabase task/event/cost evidence.

**Status:** First cloud execution proof COMPLETE. Generic task dispatch/routing remains pending.


---

## 2026-09-18 — First canonical task completed by connected ChatGPT executor

**Scope:** Cloud Operative / executor routing / RaiseHub managed-project pilot

**Owner intent:** Use the active ChatGPT connection before consuming Hermes/model credits whenever ChatGPT already has the tools and permissions required for the task.

**Changes / decisions:**
- The real Owner Console task `Check out raisehub.app and let me know if there are any improvements I could make` was claimed from canonical CoOperative state by `connected-chatgpt`.
- The task progressed through `queued -> planning -> executing -> verifying -> completed`.
- ChatGPT reviewed the live RaiseHub production site, Vercel production/runtime health, and the current RaiseHub repository/docs.
- Findings were persisted back into `operative_tasks.result`, task events were recorded, and a Cost Governor ledger entry recorded $0 incremental CoOperative/Hermes model spend.
- The task's owner-provided maximum spend cap was $0.50; actual recorded marginal spend was $0.
- Owner Console Mission Control was extended to render structured completed-task findings instead of leaving results visible only in the database.
- This proves that connected ChatGPT can function as one governed executor while CoOperative remains the canonical task/evidence system.

**Why:** The owner already pays a fixed ChatGPT subscription and wants Hermes credits reserved for capability gaps. This validates the intended executor split with a real managed-project task.

**Affected areas:** Executor Router, Cost Governor, Mission Control results, RaiseHub improvement pilot, future ChatGPT bridge.

**Conflict / supersession notes:** This does not mean Owner Console can independently summon this ChatGPT session yet. Automatic ChatGPT dispatch still requires a controlled ChatGPT/CoOperative bridge. The task was executed through the currently active connected owner session.

**Source:** Owner-created CoOperative task plus connected ChatGPT/Vercel/GitHub execution and Supabase evidence.

**Status:** Connected-ChatGPT executor pattern proven manually; bridge automation pending.

---

## 2026-09-18 — Cloud Hermes becomes an on-demand task-scoped runtime

**Scope:** Cloud Operative / Hermes / model routing / Vercel Sandbox

**Owner intent:** Move Hermes capability off the Mac without creating an expensive always-on server, and make CoOperative—not a mutable Hermes default—the authority for model choice and spend.

**Changes / decisions:**
- Added a credential-free `hermes-runtime-check` playbook to prove the pinned official Hermes runtime can install and execute inside Vercel Sandbox before any provider credential is migrated.
- Added a dormant server-only Cloud Hermes adapter that refuses to run unless `NOUS_API_KEY` is explicitly configured.
- Owner task text is written into the Sandbox as a file and supplied through Hermes `--query-file`; owner text never becomes shell commands.
- Only the provider credential is passed into the Hermes Sandbox. `SUPABASE_SECRET_KEY` and other platform secrets are not injected.
- Hermes runs with task-scoped model/provider, bounded max turns, bounded runtime, machine-readable usage capture, and guaranteed Sandbox shutdown.
- Added task-scoped model-routing policy: standard work prefers the approved low-cost model and may fall back on recognized availability failures; advanced work preserves a stronger quality floor and must not silently downgrade.
- Model ladders can be overridden by environment configuration so provider/model changes do not require architectural rewrites.

**Why:** Cloud Hermes should be ephemeral reasoning/execution infrastructure governed by CoOperative policy and Cost Governor, not a permanent VM or a single manually selected model.

**Affected areas:** Cloud Hermes adapter, AI Router, Cost Governor, Vercel Sandbox, Owner Console, future generic dispatcher.

**Conflict / supersession notes:** Reinforces the earlier model-routing decision and the event-driven infrastructure strategy. Provider authentication remains an explicit owner gate and has not been configured.

**Source:** Owner-authorized ChatGPT implementation after successful Mac-independent deterministic Cloud Operative proof.

**Status:** Runtime/model-routing code prepared in Preview; credential-free Hermes runtime test and later provider-auth gate remain.


---

## 2026-09-18 — Long-running cloud tasks moved off synchronous Owner Console requests

**Scope:** Cloud Operative / Vercel Sandbox / Cloud Hermes / Mission Control

**Owner intent:** Long-running cloud/Hermes work should not leave the phone stuck on "Working…" or require the browser connection to remain open.

**Changes / decisions:**
- The first Cloud Hermes runtime check entered `executing` successfully but remained tied to the synchronous `/execute` request for roughly four minutes.
- Vercel eventually closed the Sandbox stream; CoOperative recorded the task as `failed` with `Sandbox stream was closed and is not accepting commands.`
- The failure was not a Supabase/auth/task-state problem; it exposed that Vercel `runCommand` waits for completion and is the wrong interaction model for long installs/agent work.
- Added named persistent Vercel Sandbox execution for long-running playbooks.
- Added a detached Node runner that executes the reviewed allow-listed commands inside the seeded repository, writes its own status/summary evidence, and remains bounded by a hard deadline.
- The Owner Console execution API now returns HTTP 202 immediately for detached playbooks instead of keeping the phone request open.
- Added a governed poll/finalize endpoint that reconnects to the named Sandbox, reads terminal evidence, records success/failure/cost/task events, and stops the Sandbox.
- Owner Console now automatically polls active detached tasks and updates Mission Control without keeping the action button in a long-running pending state.
- Synchronous playbooks such as the fast Cloud self-check remain synchronous; long-running playbooks such as the Hermes runtime check use detached execution.
- Final branch validation passed unit tests, TypeScript, lint, and build; corrected Preview is READY.

**Why:** Owner Console should be a control plane, not a terminal session. Cloud execution must survive independently of the phone/browser request and report durable state back to CoOperative.

**Affected areas:** Vercel Sandbox adapter, task execution API, detached-task polling/finalization, Owner Console, Cloud Hermes, future long-running migrations/builds/research.

**Conflict / supersession notes:** Supersedes the earlier synchronous Cloud Hermes runtime-check implementation. The earlier failed task remains preserved as evidence; it was not erased or retried in place.

**Source:** Owner phone test plus Supabase task evidence, Vercel runtime logs, current Vercel Sandbox async/persistent documentation, and ChatGPT implementation.

**Status:** Detached long-running execution architecture deployed to Preview and CI-green; Cloud Hermes runtime retest pending.


---

## 2026-09-18 — Cloud Hermes orchestration moves to Vercel Workflow + prepared runtime

**Scope:** Cloud Operative / Cloud Hermes / Vercel Workflow / runtime preparation

**Owner intent:** Avoid cold-installing Hermes for every task, expose meaningful progress, and ensure cloud work completes/fails durably even if the phone/browser disconnects.

**Changes / decisions:**
- The detached Hermes runtime test exceeded its 10-minute deadline and remained `executing` after client polling stopped.
- The stale task was explicitly finalized as `failed` with evidence preserved; no open-ended execution state was retained.
- Client/browser polling is no longer considered authoritative for task completion.
- CoOperative should use Vercel Workflow DevKit for long-running Cloud Operative/Hermes orchestration because it provides durable, crash-safe, step-based execution, retries, and state independent of the browser request.
- The Owner Console remains a control plane and status viewer; it must not be responsible for keeping execution alive.
- Cloud Hermes should use a prepared runtime snapshot/image containing pinned Hermes and dependencies rather than performing a full cold install per task.
- Workflow steps should emit durable progress/heartbeat state such as `preparing runtime`, `starting Hermes`, `executing task`, `verifying`, and `finalizing`.
- Fast deterministic playbooks may remain direct/synchronous where appropriate; long-running reasoning/migration/build/agent work should use durable Workflow orchestration.
- Provider/model credentials remain separate owner-gated secrets and are not part of the prepared image.

**Why:** Durable orchestration is a platform concern. Browser-driven polling and repeated cold installs add latency, cost, failure modes, and poor visibility.

**Affected areas:** Cloud Hermes runtime, task lifecycle, Mission Control progress, Vercel Sandbox, future migrations/builds/research, Cost Governor.

**Conflict / supersession notes:** Supersedes the custom client-driven detached-polling architecture as the long-term orchestration model. Existing detached code remains bootstrap evidence until replaced. The event-driven/no-always-on-server strategy remains unchanged.

**Source:** Owner agreement after live runtime test, current Vercel Workflow guidance, and persisted task evidence.

**Status:** Active architecture decision. Next implementation target: prepared Hermes runtime + Vercel Workflow-backed execution.


---

## 2026-09-18 — Cloud Hermes runtime moved to durable Vercel Workflow with reusable prepared Sandbox

**Scope:** Cloud Operative / Cloud Hermes / Vercel Workflow / prepared runtime

**Owner intent:** Make long-running Hermes/cloud work durable, independent of the phone/browser, observable by stage, and faster after the first run by reusing a prepared runtime instead of reinstalling Hermes every task.

**Changes / decisions:**
- Added pinned `workflow@4.8.9` and enabled `withWorkflow()` in Next.js.
- Excluded `/.well-known/workflow/` from the Supabase auth proxy so Workflow's internal transport is not intercepted.
- Added a durable `hermesRuntimeWorkflow` using `"use workflow"` orchestration and `"use step"` Node-capable steps.
- Hermes runtime preparation is versioned as `cooperative-hermes-runtime-v2026-9-14`.
- First use creates a persistent named Vercel Sandbox with a 15-minute cold-install session, installs/verifies pinned Hermes, then stops it so Vercel snapshots the prepared filesystem.
- Prepared runtime snapshots are configured with a 30-day expiration window.
- A partially prepared runtime is deleted if setup fails so future work cannot accidentally reuse a broken base.
- Later runtime checks fork an isolated non-persistent Sandbox from the prepared runtime instead of repeating the full install.
- Workflow records durable progress stages in canonical task state: `preparing_runtime`, `starting_hermes`, `executing_check`, `verifying`, `completed`, or `failed`.
- The Owner Console now refreshes Workflow-owned tasks from canonical state; browser polling is only a viewer/refresh mechanism and is no longer responsible for finalizing the execution.
- The existing fast deterministic Cloud self-check remains a synchronous playbook.
- Guardrail tests verify Workflow integration, version pinning, prepared-runtime reuse, progress stages, and that provider/Supabase secret names are not embedded in the prepared Hermes workflow.
- Final branch validation passed unit tests, TypeScript, lint, and build.
- Final Preview deployment `dpl_2UUTXGumgwKzbB39StsDNn1REyim` is READY at `co-operative-n9ber9sti-zanibethels-projects.vercel.app`.

**Why:** A durable workflow plus a prepared runtime removes the two problems found in live testing: browser-owned finalization and repeated cold installation. It also gives Mission Control meaningful, durable progress rather than a generic `executing` state.

**Affected areas:** Owner Console, Vercel Workflow, Vercel Sandbox persistence/forking, Cloud Hermes bootstrap, task evidence, Cost Governor, future long-running agents/migrations/builds.

**Conflict / supersession notes:** Supersedes the custom detached Sandbox polling path for Cloud Hermes. The old detached implementation remains only as bootstrap compatibility/evidence until removed. Provider authentication/model execution remains a separate explicit owner gate.

**Source:** Owner-approved ChatGPT implementation, Vercel Workflow/Sandbox documentation, GitHub CI, and Vercel Preview verification.

**Status:** Durable prepared-runtime bootstrap deployed to Preview and ready for live retest.


---

## 2026-09-18 — Prepared Hermes runtime succeeded; bootstrap verification simplified

**Scope:** Cloud Hermes / Vercel Workflow / prepared runtime verification

**Observed live result:**
- Workflow run `wrun_01M2T36X6N9XAS6X4BZ0KCBFMA` successfully completed the expensive one-time Hermes runtime preparation.
- Canonical task evidence recorded `preparedRuntime.createdThisRun = true` for `cooperative-hermes-runtime-v2026-9-14`.
- Workflow advanced through `preparing_runtime -> starting_hermes -> executing_check`.
- The failure occurred only in the disposable verification fork. The `hermes prompt-size --json` diagnostic kept the Sandbox SDK request open until the underlying fetch was terminated.
- Vercel Workflow retried the verification step four times and then failed the task. No provider/model call was made.

**Changes / decisions:**
- The prepared Hermes base is retained and should be reused; do not reinstall it for the next check.
- Removed `prompt-size` from the bootstrap runtime proof. It is an offline diagnostic that constructs a real inspection agent and is unnecessary for proving that the restored Hermes CLI works.
- Snapshot verification now uses bounded lightweight `hermes --version` and `hermes --help` checks with 30-second command limits.
- Forked verification Sandboxes have an explicit 2-minute lifetime.
- Workflow failure serialization now preserves non-native error names/messages so Mission Control should show useful failure detail instead of only a generic message.
- Owner Console wording updated to reflect fast restored-runtime verification.
- Final commit `c569a40d9ab42e2bfaeb84ffb77cf58ceff5cdde` passed unit tests, TypeScript, lint, and build; Preview `dpl_46vL5siqgbouv232kQam8a3KU9Mw` is READY.

**Why:** Runtime bootstrap should prove that the prepared Hermes executable survives snapshot/restore and its CLI registry loads. Heavy diagnostics belong in separate diagnostic playbooks, not in the critical bootstrap proof.

**Status:** Prepared runtime exists; lightweight reuse test ready for live retest.


---

## 2026-09-18 — First successful reusable Cloud Hermes runtime proof

**Scope:** Cloud Hermes / Vercel Workflow / prepared Sandbox reuse

**Owner intent:** Prove that Hermes can live as a reusable cloud runtime, execute independently of the Mac/browser, and avoid repeated cold installation.

**Verified result:**
- Canonical task `c163b381-9abe-4bc4-9af3-6a6bc3cac3a7` completed successfully.
- Workflow run `wrun_01M2T5RK0NWRKZBSENZXNCDH7C` progressed through `preparing_runtime -> starting_hermes -> executing_check -> verifying -> completed`.
- Prepared runtime `cooperative-hermes-runtime-v2026-9-14` was reused from snapshot (`reusedSnapshot: true`; `createdThisRun: false`).
- Forked verification Sandbox: `plum-inc-tick-FCX1Jk`.
- Verified Hermes Agent `v0.21.3 (2026.9.14)`, Python 3.11.16, OpenAI SDK 2.24.0.
- Lightweight restored-runtime verification took approximately 3.9 seconds.
- End-to-end task lifecycle from creation to completion was approximately 18 seconds.
- Task state transitioned `queued -> planning -> executing -> verifying -> completed`.
- Cost ledger recorded $0 direct marginal task cash cost; allocated Vercel Sandbox/Workflow usage remains a separate platform economics item.
- No provider/model credential was used and no model call occurred.

**Why this matters:** This proves the reusable cloud-Hermes runtime layer works independently of the Mac and browser. Future Cloud Hermes work can start from the prepared snapshot rather than reinstalling Hermes each time.

**Affected areas:** Cloud Hermes, Executor Router, Vercel Workflow, Sandbox snapshot reuse, Cost Governor, Mission Control.

**Conflict / supersession notes:** Supersedes the earlier failed cold-install verification attempts as the current validated Cloud Hermes runtime state. It does not yet prove a model-backed Hermes reasoning task; provider authentication/model routing remain the next gated step.

**Source:** Supabase canonical task/event/cost evidence plus Owner Console live run.

**Status:** Reusable Cloud Hermes runtime proof COMPLETE. Next gate: Preview-only provider authentication + first governed model-backed Hermes task.


---

## 2026-09-18 — First governed model-backed Cloud Hermes path prepared using Vercel OIDC

**Scope:** Cloud Hermes / AI Gateway / executor routing / Cost Governor / Owner Console

**Owner intent:** Prove real model-backed Hermes execution in the cloud while minimizing cost and avoiding duplicated long-lived provider credentials.

**Changes / decisions:**
- Added reviewed playbook `hermes-model-smoke`.
- Added `cloud-hermes` as an explicit executor identity separate from `deterministic-code`.
- The model smoke test reuses the already prepared Hermes runtime snapshot; it does not cold-install Hermes again.
- Provider route is Vercel AI Gateway using the deployment's short-lived `VERCEL_OIDC_TOKEN`, injected into the disposable Sandbox only as `AI_GATEWAY_API_KEY`.
- No Nous API key or other long-lived provider credential is stored in CoOperative, Vercel environment variables, the repository, or the prepared Hermes snapshot for this path.
- The smoke test uses `alibaba/qwen-3-14b` as a low-cost, tool-capable language model available through AI Gateway.
- The task is fixed and single-turn: `--max-turns 1`, 60-second Hermes run budget, 75-second process timeout, safe mode, user-config/rules disabled, no arbitrary owner shell input.
- The fixed reasoning proof asks the model to compute 17 × 23 and explain briefly why deterministic code is normally preferable for arithmetic; successful verification requires the response to contain 391.
- Owner Console exposes this as a dedicated explicit paid action with a maximum incremental task spend of **$0.02**.
- Hermes `--usage-file` output is required; CoOperative reads grand-total model usage/cost, converts the reported USD estimate to microunits, enforces the task cap, persists actual task spend, and writes AI-token and Sandbox entries to the cost ledger.
- Mission Control renders the returned model/provider/output/token/cost evidence.
- The existing generic task path is not granted arbitrary Cloud Hermes shell authority by this change.
- Final head `89103334e49f899a1670ee3718c66ae20eb3e224` passed unit tests, TypeScript, lint, and build.
- Preview deployment `dpl_7siEGRdjUuYU165THYDNfxcSK4rw` is READY at `co-operative-8j4z5kpl9-zanibethels-projects.vercel.app`.

**Why:** Vercel OIDC gives the cloud runtime temporary deployment identity and avoids copying the owner's local Hermes/Nous credential. A fixed low-cost smoke task proves the paid reasoning path before any broader autonomous model-backed execution is enabled.

**Conflict / supersession notes:** This improves the earlier plan to configure a Preview-only long-lived provider secret. The active approach uses short-lived Vercel OIDC instead. Broader generic Cloud Hermes dispatch remains pending until this fixed smoke test succeeds.

**Source:** Owner approval ("OK go"), Vercel AI Gateway/Hermes integration guidance, current AI Gateway model catalog, and ChatGPT implementation/CI verification.

**Status:** Model-backed Cloud Hermes smoke path DEPLOYED TO PREVIEW; live owner-triggered test pending.


---

## 2026-09-18 — Cloud Hermes executor naming corrected to existing database contract

**Scope:** Cloud Hermes / executor routing / task state recovery

**Observed live result:**
- First model-backed smoke attempt was rejected before execution by `operative_tasks_selected_executor_check`.
- The database already had the canonical executor value `hermes-cloud-operative`; the new code incorrectly introduced `cloud-hermes`.
- No Hermes model call occurred and actual task spend remained 0 microunits.

**Changes / decisions:**
- No database migration was applied.
- Model-backed Hermes playbook now uses the existing canonical executor `hermes-cloud-operative`.
- Cost-ledger entries for Hermes model usage use the same canonical executor value, which is already allowed by `cost_ledger_entries_executor_check`.
- Added regression tests to prevent reintroduction of the non-canonical executor name.
- Executor-claim failures now transition the task to `failed` and persist an audit event instead of leaving a stranded `planning` task.
- The failed live task `968798b3-7e09-4c6f-8c49-507568521626` was finalized as `failed` with explicit evidence that no model call occurred and $0 was spent.
- Final head `07fc04803fac72f23f9cb2e87e3d5a230fca47f5` passed unit tests, TypeScript, lint, and build.
- Corrected Preview deployment `dpl_GxhsxTPs7W5PHwY2wKKmtyH95LKP` is READY.

**Why:** Existing schema contracts should be reused rather than widened when the mismatch is in application naming. This keeps executor policy tighter and avoids an unnecessary database migration.

**Status:** FIXED. Model-backed Cloud Hermes smoke test ready for retry.


---

## 2026-09-18 — Workflow AI Gateway auth switched to Vercel OIDC helper

**Scope:** Cloud Hermes / Vercel Workflow / AI Gateway authentication

**Observed live result:**
- The corrected `hermes-cloud-operative` smoke task reached Vercel Workflow successfully.
- Workflow run `wrun_01M2T7BJKYBAGTW7WME5SK8G8D` failed before any model request because `process.env.VERCEL_OIDC_TOKEN` was unavailable inside the Workflow step runtime.
- No AI Gateway/model call occurred and task spend remained 0 microunits.

**Changes / decisions:**
- Replaced direct environment-variable access with Vercel's supported `getVercelOidcToken()` helper from `@vercel/oidc`.
- Added `@vercel/oidc@3.2.0` as an explicit pinned dependency, matching the already-present locked package version.
- The short-lived token returned by the helper is injected only into the disposable Hermes Sandbox as `AI_GATEWAY_API_KEY`.
- No long-lived Nous/API Gateway provider credential was added.
- Structured Workflow error serialization was improved to preserve object/cause messages when future failures occur.
- Regression tests now require the OIDC helper path and reject direct `process.env.VERCEL_OIDC_TOKEN` access.
- Final head `7c99b9424c956c07accb8f0fd01de8e06adfbd98` passed unit tests, TypeScript, lint, and build.
- Preview deployment `dpl_HpRECPfBabPBumRH8zAMsWSxZWS2` is READY at `co-operative-r7rfoqxa4-zanibethels-projects.vercel.app`.

**Why:** Workflow steps are not guaranteed to expose the deployment OIDC token as a plain environment variable. The supported helper preserves short-lived Vercel identity without introducing a permanent provider secret.

**Status:** FIXED. Model-backed Cloud Hermes smoke test ready for retry.


---

## 2026-09-18 — Model smoke failure traced to shell command construction, not Hermes or AI Gateway

**Scope:** Cloud Hermes / model smoke / Workflow shell execution

**Observed live result:**
- Workflow run `wrun_01M2T83D88WJAZ6A0DWXMCW5W2` reached the OIDC-backed model smoke step.
- The task failed with `timeout: failed to execute process: No such file or directory (os error 2)`.
- Hermes produced no usage report because the Hermes process never actually launched.
- No model call occurred and task spend remained 0 microunits.

**Root cause:**
- The shell command was assembled by joining setup fragments with spaces.
- `HERMES_BIN=...`, the fallback executable check, and `timeout ...` therefore did not become separate shell statements.
- `$HERMES_BIN` expanded before the intended assignment took effect, leaving `timeout` with an empty executable path.

**Changes / decisions:**
- Rebuilt the Hermes CLI invocation from tokenized arguments.
- Shell setup now uses explicit semicolon-separated statements, verifies the resolved Hermes executable with `test -x`, and only then executes the bounded command.
- Added shell-safe quoting for each Hermes argument.
- Added regression coverage requiring explicit separators and rejecting the old `].join(" ")` command-construction pattern.
- Updated existing source-inspection tests to validate the tokenized argument form.
- Final head `84431e73eca7129c28262785770d275e918f7738` passed unit tests, TypeScript, lint, and build.
- Preview deployment `dpl_36v4XjjWyjxegp21dgexKXS7SCa8` is READY at `co-operative-numrkl1z0-zanibethels-projects.vercel.app`.

**Why:** The failure was local command assembly, not provider authentication or Hermes capability. Fixing the invocation preserves the OIDC/no-long-lived-secret design and avoids unnecessary provider/schema changes.

**Status:** FIXED. Model-backed Cloud Hermes smoke test ready for retry.


---

## 2026-09-18 — Hermes CLI global/chat flag ordering corrected

**Scope:** Cloud Hermes / model smoke / Hermes CLI invocation

**Observed live result:**
- Workflow run `wrun_01M2T8M7CJPRZYVM99A672XS5V` successfully launched the Hermes executable.
- Hermes rejected the invocation with `unrecognized arguments: --usage-file /tmp/hermes-usage.json`.
- The pinned Hermes CLI exposes `--usage-file` as a top-level flag, while query/run-budget flags belong to the `chat` subcommand.
- No model call occurred and task spend remained 0 microunits.

**Changes / decisions:**
- Split the invocation into explicit `globalHermesArgs` and `chatHermesArgs`.
- Top-level flags such as `--usage-file`, `--provider`, `--model`, `--reasoning`, and isolation flags are placed before the `chat` subcommand.
- Chat-specific flags such as `--query-file`, `--oneshot`, `--max-turns`, `--run-budget`, `--quiet`, and `--source` are placed after `chat`.
- Added regression coverage that verifies `--usage-file` stays out of the chat-only argument block and global arguments precede the subcommand.
- Final head `6b01a800e3f4b80a4e7f864e45df81e6918a09c8` passed unit tests, TypeScript, lint, and build.
- Preview deployment `dpl_N96SSAoMaFZz1vqbivRZhPcWw67c` is READY at `co-operative-6nin11ymr-zanibethels-projects.vercel.app`.

**Why:** Hermes uses argparse with top-level and subcommand-specific option surfaces. Correct ordering is required even when individual flag names are valid.

**Status:** FIXED. Model-backed Cloud Hermes smoke test ready for retry.
