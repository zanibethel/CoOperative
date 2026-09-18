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
