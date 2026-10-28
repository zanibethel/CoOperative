# Things to Consider — CoOperative

Living backlog of external findings, possible upgrades, and solution ideas that may improve CoOperative.

These are **not approved implementation tasks**. Each item should be re-validated against the current codebase, current provider/docs state, cost, security, and product goals before implementation. Move an item forward only after explicit user approval.

Last reviewed: 2026-10-28

## Status key

- **Consider** — useful signal; needs research.
- **Evaluate** — worth benchmarking or prototyping.
- **Recommend** — current evidence supports implementation; still requires approval.
- **Approved** — user explicitly approved implementation.
- **Implemented** — landed and verified.
- **Rejected / Superseded** — intentionally not pursuing.

---

## 1. Prime Inference as an additional open-model provider

**Status:** Evaluate  
**Added:** 2026-10-05  
**Source:** Prime Intellect / TLDR AI

### Finding
Prime Inference advertises an OpenAI-compatible inference surface for open models with provider/data-center failover, usage tracking, and structured tool-call/schema support.

### Why it may matter
This maps closely to CoOperative's provider abstraction and fallback goals:
- replaceable providers underneath the CoOperative experience;
- cheapest-capable routing;
- failover instead of hard failure;
- structured tool calls;
- measurable cost/reliability data.

### Possible solution
Add Prime Inference only as a **candidate provider adapter** behind the existing routing contract. Do not make it a default route until measured.

### Recommended evaluation
Benchmark against current free/community/paid routes using the same eval set:
1. tool-call correctness and schema compliance;
2. refusal behavior by request category;
3. latency and timeout rate;
4. failover behavior;
5. model availability;
6. effective cost per successful task;
7. output quality by CoOperative agent role.

### Recommendation
Prototype behind a feature flag and keep it outside production routing until it beats or usefully complements an existing route.

Reference: https://www.primeintellect.ai/blog/prime-inference

---

## 2. Whistle for local/on-device speech-to-text

**Status:** Evaluate  
**Added:** 2026-10-05  
**Source:** Cactus / TLDR AI

### Finding
Whistle is presented as a very small on-device speech-to-text model designed to run on CPU and support multiple languages.

### Why it may matter
CoOperativeLocalAI needs voice without making every utterance dependent on a paid cloud speech API. A local STT layer could improve:
- privacy;
- offline/local capability;
- latency on supported hardware;
- marginal cost;
- phone-to-PC local AI workflows.

### Possible solution
Create a local speech adapter for CoOperativeLocalAI with:
`microphone/audio -> local STT -> normalized text -> existing CoOperative chat/tool pipeline`.

Keep cloud speech as an optional fallback when local quality is insufficient.

### Recommended evaluation
Test on the Mac and Windows node hardware for:
- real-time factor;
- CPU/RAM use;
- microphone noise tolerance;
- punctuation;
- names/domain vocabulary;
- English/Spanish quality;
- command/tool-input accuracy.

### Recommendation
This is a high-value prototype candidate because the integration can remain modular and reversible.

Reference: https://cactuscompute.com/blog/whistle

---

## 3. Hard AI budget caps with graceful fallback

**Status:** Recommend / draft PR #193 incomplete  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-28  
**Source:** industry discussion / current CoOperative cost-control direction

### Finding
Soft warnings are not enough for an orchestration product that may fan one user request into several provider calls.

### Why it may matter
CoOperative already treats the selected Model Mixer option as a request-level quality/cost ceiling and only permits paid AI when the user/profile has balance. Enforcement should be deterministic.

### Possible solution
Enforce layered hard caps:
- per sub-call;
- per request/mission;
- per user/profile balance;
- optional daily/monthly workspace cap.

Before a paid call:
1. estimate maximum allowed charge;
2. reserve/validate sufficient balance;
3. choose the cheapest capable route within the ceiling;
4. if the next route would exceed the cap, try deterministic/local/free/community alternatives;
5. if no acceptable route remains, return an explicit upgrade/cost choice instead of silently overspending.

### Recommended implementation
Keep budget enforcement outside the model itself in deterministic routing/ledger code. Models can suggest escalation; they cannot authorize spending above the cap.

### 2026-10-07 evidence update
Strict local/free-only routing and fixed Stripe price mapping have landed, which strengthens deterministic no-paid behavior and least-privilege checkout. The broader layered cap contract is not yet proven end to end: quoted cost, reservation, provider cost, user debit, concurrency, retry/failover, and refund/release still need one reconciliation test matrix.

### 2026-10-23 evidence update
Draft PR #193 adds pricing freshness, worst-case charge, minimum margin, and reconciliation primitives but is not wired to paid execution. Authoritative provider quotes, atomic reservations, idempotent retries, and persisted actual invoices remain unverified. The Oct 23 registry scan found 16 changed routes, including price changes, underscoring the need for execution-time verification.

### 2026-10-24 evidence update
The latest model scan found 669 routes, one new and 14 changed, including multiple provider pricing changes. These registry observations are not authoritative execution-time quotes. PR #193 remains draft and not wired to paid routes; enforce verified price, reservation, minimum margin, actual-cost reconciliation, and idempotency before any deployment.

### Recommendation
Keep PR #193 draft. Implement only after reviewing the complete quote/debit/markup path so quoted cost, reserved cost, actual provider cost, and user deduction remain reconcilable.

---

**2026-10-25 evidence:** The 13:00 UTC (08:00 Central) registry scan completed with 667 discovered routes (vs 669 Oct 24), one new, seven changed, and **three missing** (`openai/gpt-3.5-turbo`, `gpt-3.5-turbo-instruct`, and `gpt-3.5-turbo:batch` on OpenRouter). Price fields changed on several routes, including DeepSeek V4 Pro and Kimi. A registry snapshot is not a verified execution-time provider quote. PR #193 remains draft and unintegrated; preserve fail-closed spending.

**2026-10-26 evidence:** Registry scan completed at 13:01 UTC with 667 routes, zero new/missing, **23 changed** (versus seven changed Oct 25). OpenRouter `deepseek/deepseek-v4-flash-0731` registry input/output prices rose from $0.04444/$0.13332 to $0.44/$1.32 per million tokens (~9.9x); `deepseek/deepseek-v4-pro` also rose from $0.2088/$0.4176 to $0.95526/$1.91052. These are registry observations, **not** verified provider invoices or live execution quotes. Prioritize fail-closed quote freshness, max-charge reservation, minimum margin and actual-cost reconciliation in draft PR #193; no merge or production routing/pricing change.

**2026-10-27 evidence:** The completed registry scan found 8 missing routes, including a free NVIDIA Nemotron route and several Mistral batch variants; these must not silently trigger paid fallbacks. Continue the unmerged PR #193 maximum-cost reservation and provider-price reconciliation work; do not infer execution-time prices from registry fingerprints.

**2026-10-28 evidence:** Completed scan: 664 routes, 1 new, 31 changed, 0 missing. OpenRouter DeepSeek V4 Flash observed prompt price changed $0.05 to $0.091 per 1M tokens while completion changed $0.45 to $0.182; economics depend on input/output mix. Registry snapshots are not provider-authoritative execution quotes. PR #193 remains open/draft; execution-time price verification, atomic max-cost reservation, margin floor, idempotency and actual-cost reconciliation remain unverified. No paid-route or billing changes approved.

## 4. Structured project intelligence instead of chat-memory-only state

**Status:** Implemented foundation / Recommend independent verification receipts  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-28  
**Source:** TLDR Dev / current CoOperative persistence direction

### Finding
Long-running agent projects are more reliable when durable project state, decisions, open questions, and implementation notes live in versioned files rather than only conversational memory.

### Why it may matter
This matches CoOperative's code-first/playbook-first doctrine and reduces repeated rediscovery.

### Possible solution
Use a consult -> build -> update loop:
1. consult repo docs and current code before proposing a change;
2. implement only after approval;
3. update the relevant project docs after verified implementation;
4. keep provenance/status for external findings.

### 2026-10-07 evidence update
The versioned consideration and project-intelligence workflow is now in active use. OpenAI's Ironclad agent benchmark adds a useful lesson: successful tool calls or plausible intermediate steps are insufficient when the final workflow state is wrong. Cross-device tasks should produce an end-to-end completion receipt tied to explicit criteria.

### Possible solution
For delegated work, record the requested criteria, claimed completion, observed final state, verification source, unresolved conditions, and responsible node/model. Apply this first to cross-device media planning and other workflows where an Android/Mac specialist claims completion.

### 2026-10-23 evidence update
Recent agent monitoring incidents and the October 21 TLDR AI discussion of independent agent evaluation strengthen the need to verify final state outside the acting model. Preserve evidence, permission boundaries, task identity, and monitoring integrity.

### Additional 2026-10-23 memory evidence
Databricks' Oct 20 MemCurrent research reports 22.3% to 68.4% pass-rate improvement on its own enterprise benchmark, with fewer tokens and lower latency. This is vendor-run evidence, not a CoOperative result. Compare episodic/derived memory, stale-context cleanup, deletion/tenant boundaries, and cost per verified task against CoOperative's existing memory stores before considering any new backend.

### 2026-10-24 evidence update
Anthropic's Oct 22 guidance recommends comparing one progressive-disclosure agent loop against specialist subagents with end-to-end task-completion evaluations; independent verification and permission boundaries remain valid reasons to retain separate agents. METR's Oct 22 report documents historical monitor-coverage bypasses and recommends independent, tamper-resistant monitoring. 1Password's Oct 22 agent sign-in product demonstrates user-approved credential injection without exposing passwords to models, but CoOperative compatibility is not verified. Evaluate these as extensions of completion receipts, not permission to remove deterministic policy checks. Sources: https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop ; https://metr.org/blog/2026-10-22-red-teaming-openai-agent-monitoring/ ; https://1password.com/blog/1password-for-ai-agents

### Recommendation
Keep `docs/THINGS_TO_CONSIDER.md` for unapproved opportunities and `docs/PROJECT_INTELLIGENCE.md` for the standard "what's new?" workflow. Add independent deterministic completion receipts before treating a delegated task as complete.

Reference: https://openai.com/index/ironclad/

Reference: https://tldr.tech/dev/2026-10-05


---

**2026-10-26 evidence:** Anthropic's Oct 22 formal-verification research reports machine-checked security properties for over 100 open-source libraries at RISC-V assembly level, subject to explicit single-thread/static-binary assumptions. This supports a bounded, independently checked proof/contract prototype for CoOperative's billing invariants and Unison task-authorization paths, **not** a claim that LLM-generated code is bug-free. Preserve separate final-state receipts and deterministic policy checks. Source: https://www.anthropic.com/research/formal-verification .

**2026-10-28 evaluation evidence:** Cognition's FrontierCode 2.0 (Oct 27) uses more realistic mergeability/thoroughness blockers and larger repository tasks; its vendor-run scores are not CoOperative measurements. Ubicloud's Oct 20 vLLM tool-call evaluation found 92% schema-valid calls on a tested Kimi setup versus 100% with constrained decoding; schema validity does not prove correct tool selection. Add separate acceptance dimensions for scope/regression completeness, tool schema validity, semantic tool correctness and final-state receipts before comparing routes. Existing project-intelligence workflow contract remains adequate. Sources: https://cognition.com/blog/frontier-code-2.0 ; https://www.ubicloud.com/blog/fixing-tool-call-accuracy-in-vllm .

## 5. Mistral Large 4 as a registry and routing candidate

**Status:** Evaluate — API preview available; full/open-weight release unconfirmed; no CoOperative execution benchmark  
**Added:** 2026-10-06  
**Last reviewed:** 2026-10-27  
**Evidence:** Mistral release/docs, Hugging Face release page, OpenRouter live catalog/telemetry, CoOperative Supabase registry/task scores

### Release and registry finding (2026-10-27)
Mistral's official page and docs still identify **Public Preview v26.10** (API since Oct 6), not final/general availability. Its Hugging Face release page says **Upcoming release; October 31 ETA** for open weights. Do not treat the previously reported Oct 27 target as a completed launch. The 13:00–13:01 UTC CoOperative scheduled registry scan completed successfully: **663 discovered, four new, 29 changed, eight missing** (vs 667/zero/23/zero on Oct 26). The already-known OpenRouter route `mistralai/mistral-large-4-0` remains **active, execution_ready=true, recommended=false**, with no new ML4-specific scan change. Availability metadata is not an end-to-end inference success.

### Capability and benchmark evidence
- Official docs: 1.05T total / 52B active including embedding/output layers, 1.6B vision encoder, 1M context, text+image input/text output, structured JSON, tool calling, reasoning, and document Q&A. Feature **support is declared**, not validated for CoOperative's exact schemas, tool selection, prompt-injection handling, or long PDFs.
- CoOperative registry: $1.36 input / $4.18 output per million tokens; 1,048,576-token context. A reference workload of **100k input + 10k output** costs **$0.1778** at observed list prices, before caching, retries, fees, markup, or provider price changes.
- Same-scan OpenRouter peers for that workload: Qwen3.8 Omni Flash **$0.0197** (vision/tools/structured), GPT-6.1 Terra **$0.1500** (vision/tools/structured), DeepSeek V4 Pro **$0.1077** (text/tools/structured; no vision), Claude Sonnet 5.5 **$0.3000** (vision/tools/structured), and legacy Mistral Large 2407 **$0.2600** (no vision). These are **metadata-based cost comparisons, not measured cost per successful task**.
- External benchmarks: OpenRouter's aggregated third-party data lists Artificial Analysis Intelligence Index **38.4**, long-context reasoning **81.3%**, and Terminal-Bench 4.0 **26.8%** for **ML4 Preview**; do not generalize to final weights or CoOperative tasks. Mistral's own Oct 6 report cites **59.9% AutomationBench** and **61.7% DeepSWE**, but these are vendor-reported results.
- External route telemetry (OpenRouter, observed Oct 27): approximately **99.58% successful inference availability over 72h**, **99.49% over 24h**; listed standard endpoints show ~**2.4–2.75 s median latency** and **49–50 tokens/s**. This is provider aggregate telemetry, **not CoOperative p95, error-rate, or latency measurement**.
- CoOperative `ai_model_task_scores`: ML4 coding/reasoning/general-text/vision scores have **zero quality, runtime, and latency samples**, and `benchmark_coverage=0`; derived value scores (~52.2–52.3) have low confidence (0.32) and **must not be represented as an empirical head-to-head win**. `ai_model_capability_evidence` has no ML4-specific rows.
- Refusal/policy behavior: **unverified for CoOperative**. Mistral discusses reduced cybersecurity refusals; this does not establish alignment with CoOperative permissions, data policy, or safe/unsafe request handling. No matched refusal or adversarial tests were executed.
- Full-weight self-hosting is not presently validated, and a ~1T-parameter model is not suitable for existing CPU/Mac/Galaxy-class Unison nodes.

### Possible solution and acceptance gate
Run a **bounded, nonproduction, approval-gated** head-to-head against Qwen3.8 Omni Flash, DeepSeek V4 Pro, GPT-6.1 Terra and a premium vision route using identical pinned prompts/versions: (1) JSON schema and multi-tool selection correctness; (2) coding, reasoning and document-answer quality with ground truth/citations; (3) p50/p95 latency, timeout and retry reliability; (4) actual provider bill and cost per verified success; (5) benign security-task versus disallowed-task refusal consistency and prompt-injection resistance; (6) charts, screenshots, multi-page PDFs and long-context retrieval. Minimum multiple repetitions per scenario; store timestamps, route IDs, errors, actual usage and reviewer results. Do not send sensitive production data. Apply current hard-budget caps and independent verification.

### Recommendation
**No default production route, automatic paid fallback, or provider-price/routing change.** Keep ML4 discoverable as an unpromoted preview candidate. Recheck official final release, weight license, version and provider prices; only propose a task-specific promotion after reproducible, cost-controlled CoOperative tests demonstrate value and the user explicitly approves. No production code, schema, routing or pricing was changed in this review.

Sources:
- https://mistral.ai/news/mistral-large-4/
- https://docs.mistral.ai/models/mistral-large
- https://huggingface.co/mistralai/Mistral-Large-4-1T-A52B
- https://openrouter.ai/mistralai/mistral-large-4-0-20261006
- https://artificialanalysis.ai/models/mistral-large-4/

---

## 6. Verify macOS worker patch level and Screen Sharing exposure

**Status:** Recommend operational verification  
**Added:** 2026-10-06  
**Last reviewed:** 2026-10-06  
**Source:** Apple security advisory / TLDR Tech

### Finding
Apple documents CVE-2026-65400, a Screen Sharing authentication flaw that can let a network attacker authenticate without valid credentials. Apple lists patched releases including macOS Tahoe 26.6.1, and the fix is also included in Tahoe 26.7.

### Why it may matter
The Mac is an active CoOperative/Unison worker. A compromised worker could expose local data, model assets, secrets, or task execution even if application-level routing is correct.

### Possible solution
Add a lightweight node-security preflight/checklist:
1. verify the worker's macOS version is at or above a fixed release;
2. verify Screen Sharing is disabled unless explicitly needed;
3. do not expose Screen Sharing/VNC directly to the public internet;
4. record OS/security posture in node capability metadata without storing sensitive host details;
5. block sensitive workloads when a node is known to be below the required patch floor.

### Recommendation
First perform a read-only check of the Mac worker's OS version and Screen Sharing exposure. Implementing automated node attestation or workload blocking requires separate approval.

References:
- https://support.apple.com/en-us/148170
- https://support.apple.com/en-us/149042


---

## 7. EmbeddingGemma 2 for Galaxy-node retrieval and intent routing

**Status:** Evaluate on Android/Galaxy node  
**Added:** 2026-10-07  
**Last reviewed:** 2026-10-07  
**Source:** Google Developers Blog / official model documentation

### Finding
Google released EmbeddingGemma 2, a 740M open-weight multimodal embedding model for text, images, video, and audio. Google reports modular active-memory use of roughly 191 MB for text-only and 567 MB for the full model on a Pixel 11 Pro, with zero-shot intent routing and MediaPipe Tasks/LiteRT deployment paths.

### Why it may matter
This is a closer fit for CoOperative's Galaxy node than a large generative model. It could support private local semantic retrieval, intent routing, media triage, and cross-device handoff while keeping raw content on-device.

### Possible solution
Add it only as a benchmark candidate behind the existing node-capability contract. Measure retrieval/intent quality, cold start, latency, active RAM, index size, battery/thermal impact, and failure behavior on the actual Galaxy hardware. Advertise the capability only after the benchmark passes.

### Recommendation
Do not make it a default router or bundle it into production yet. Run a narrow opt-in benchmark against the current text-embedding/routing baseline and require capability-specific evidence before scheduling work to the node.

Reference: https://developers.googleblog.com/en/introducing-embeddinggemma-2/

---

## 8. Provider-model registry volatility and benchmark quality

**Status:** Evaluate model routes / monitor provider availability  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-28

**Evidence:** Oct 23 registry scan completed: 668 discovered routes, one new and 16 changed; `minimax/minimax-m3.1-flash:free` was marked missing/not execution-ready, while several routes changed pricing. The hard-budget entry covers financial enforcement.

**2026-10-24 evidence:** Today's scan completed with 669 discovered, one new, 14 changed, zero missing. Pricing fields changed for several OpenRouter models (including DeepSeek V4 Flash and Kimi); no provider-invoice or effective execution price is established by the scan. Continue availability and cost-per-verified-task benchmarks; never silently promote paid fallbacks.

**Possible solution:** Compare registry evidence with current official provider metadata; benchmark only available routes on verified task completion, p95 latency, policy fit, and effective cost. Treat missing promotional free routes as unavailable, not billable fallbacks.

**2026-10-25 evidence:** Latest scan discovered 667 routes, one new, seven changed and three missing; the three missing legacy GPT-3.5 OpenRouter routes are no longer execution-ready. A newly discovered OpenRouter `liquid/lfm-2.5-2.6b` route corresponds to an existing August model, not a newly released model. Liquid documents on-device/MLX/llama.cpp support, while OpenRouter warns hosted prompts/outputs may be retained for training. Compare local privacy/latency and hosted cost/retention before any registry promotion. Sources: https://www.liquid.ai/blog/lfm2-5-2-6b ; https://openrouter.ai/liquid/lfm-2.5-2.6b%3Afree

**Recommendation:** No production promotion, routing change, or automatic paid fallback without evaluation and approval.

**2026-10-26 evidence:** The latest registry scan has 667 routes, 23 changes, zero new/missing. DeepSeek V4 Flash 0731's observed token prices increased about 10x, with other DeepSeek/Kimi/Qwen and media capability/pricing changes. Compare provider-authoritative pricing and benchmark cost per verified task; do not silently promote paid alternatives or infer real-time charges from registry fingerprints.

**2026-10-27 evidence:** Scan completed: 663 routes discovered, 4 new, 29 changed, 8 missing (Oct 26: 667/0/23/0). Missing routes include `nvidia/nemotron-3-super-120b-a12b:free` and several Mistral batch routes; changed entries include Nous media route pricing/capabilities. Confirm actual provider prices and cost per verified task before any route promotion. The separate Mistral Large 4 preview assessment in section 5 was already reviewed today and remains unpromoted.

**2026-10-28 evidence:** Registry completed with 664 discovered, 1 new, 31 changed and 0 missing. New OpenRouter `prism-ml/ternary-bonsai-2-9b` route is unbenchmarked; its observed $0.08/$0.13 per 1M prompt/completion tokens is metadata, not a verified provider invoice. `deepseek/deepseek-v4-flash` changed prompt $0.05->$0.091 and completion $0.45->$0.182 per 1M. LFM3 launched Oct 27 but no `lfm3` route was found in the current registry; see separate local benchmark consideration #12. Do not silently promote new or changed paid routes.

## 9. Unison effective availability versus registered state

**Status:** Recommend operational audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-28

**Evidence:** Six stored node registrations all report `online`, but last heartbeats are Mac Oct 15, Galaxy Oct 12 or earlier, and CARROT Oct 3. Multiple Galaxy rows may be historical registrations.

**2026-10-24 evidence:** All six node records remain stored as online, with the newest Mac heartbeat Oct 15, Galaxy Oct 12, and CARROT Oct 3. No new task-claim/heartbeat evidence was found in the reviewed registry; stored online remains an unverified operational claim.

**Possible solution:** Derive availability from heartbeat age, task-claim evidence, capabilities, and revocation state; separately report registration and operational health. Test worker restart, bounded retries, and idempotent task recovery.

**Recommendation:** Read-only node inventory and nonproduction resilience benchmark first; changing routing or node policy requires approval.

**2026-10-26 evidence:** All six stored registrations remain `online` without fresh heartbeats: Mac last Oct 15, Galaxy Oct 12 or earlier, CARROT Oct 3. Operational availability is unverified. Continue read-only effective-health and task-claim audit before changing node selection.

**2026-10-28 evidence:** All six stored registrations still say `online`, but the latest Mac heartbeat is Oct 15, Galaxy Oct 12 and CARROT Oct 3. No fresh node availability was established. Status unchanged: read-only operational audit before any node-selection or routing change.

## 10. AI supply-chain and runtime patch verification

**Status:** Evaluate / read-only exposure audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-28

**Evidence:** LiteLLM 1.107.0 PyPI/Docker artifacts were malicious on Oct 21; Node.js released Oct 21 security patches for supported lines. No confirmed compromise of CoOperative was established.

**Possible solution:** Inventory dependencies, lockfiles, containers, worker environments, CI artifacts, and actual Node versions; compare any LiteLLM use against affected artifact digests/time windows. Keep agent permissions and completion verification independent of agent self-reporting.

**2026-10-25 evidence:** NVIDIA OpenShell documents externally enforced sandbox network/filesystem policies and human-reviewed network-policy proposals. This is a reference for a read-only comparison against Hermes/Unison node controls, not evidence of an incident or approval to replace the current security policy. Source: https://docs.nvidia.com/openshell/latest/reference/default-policy

**Recommendation:** Only if affected artifacts ran, isolate/rebuild and rotate reachable secrets per vendor guidance; otherwise monitor. Any security-policy or runtime change requires approval.

**References:** https://docs.litellm.ai/blog/security-incident-oct-21-2026 ; https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

---

**2026-10-27 evidence:** Forever Security's Oct 22 primary-source research (widely reported Oct 26) documents malicious `AGENTS.md`/`CLAUDE.md` instruction files planted in Downloads or untrusted directories that can redirect coding agents toward credential exposure or malware execution. No CoOperative compromise is established. Evaluate a read-only inventory of agent working directories, trusted instruction-file provenance, MCP/base-URL configuration and sandbox/approval enforcement across Hermes/Unison. Do not allow downloaded instruction files to override permissions; changes to security policy require approval. Source: https://forever.security/blog/hijacking-ai-agents-via-downloads-folder .

**2026-10-28 evidence:** Cloudflare's disclosure of a GLM-5.3 Workers AI SGLang KV-cache isolation failure reports 155 cross-customer responses before remediation. This is a provider-side incident, **not evidence of CoOperative exposure**. Evaluate provider isolation assurances, sensitive-prompt routing, cache reuse, and independently enforced tenant boundaries alongside existing untrusted-instruction protections. No policy change authorized. Source: https://blog.cloudflare.com/kv-cache-exposure-remediation/ .

## 11. TanStack AI 1.0 interoperability and experimental harness

**Status:** Evaluate / no migration approved  
**Added:** 2026-10-25  
**Last reviewed:** 2026-10-25

**Evidence:** TanStack AI 1.0 (Oct 23) stabilizes provider-agnostic chat, tools, media, MCP, persistence, and sandbox APIs; its new agent harness is explicitly experimental/0.x. CoOperative's current package manifest does not list TanStack AI, and CreatorHub currently uses the separate `ai` package. Source: https://tanstack.com/blog/tanstack-ai-1-0

**Possible solution:** In an isolated proof of concept, compare AG-UI/MCP adapter interoperability, test fixtures, approval controls, streaming and cost/latency against existing CoOperative primitives. Avoid parallel orchestrators and preserve deterministic budgets, credential boundaries, and independent completion receipts.

**Recommendation:** Benchmark only; no framework migration, dependency change, or production routing adjustment without explicit approval.

---

## 12. LFM3 compact multimodal/local-agent evaluation

**Status:** New / Evaluate in isolated benchmark; no route promotion  
**Added:** 2026-10-28  
**Last reviewed:** 2026-10-28

**Evidence:** Liquid AI released open-weight LFM3 on Oct 27: 1.7B text model (256K context, about 1 GB 4-bit weights), plus ~2B-class vision, audio, omni and decision variants. Vendor benchmarks report improved tool/agent capability versus LFM2.5, but no CoOperative/Unison hardware test exists. The Oct 28 CoOperative registry scan has **no LFM3 route**; registry discovery and model release are distinct. Liquid's licensing page describes free commercial use below $10M annual revenue, subject to license terms. Sources: https://www.liquid.ai/blog/lfm3 ; https://www.liquid.ai/pricing .

**Why it matters:** Candidate for local intent/tool routing, document/GUI extraction and low-cost multimodal tasks on Mac/Windows/Galaxy; avoid cloud inference for private inputs where feasible. Hardware-specific runtime and thermal performance are unknown.

**Possible solution:** After node-health recovery, benchmark LFM3 text and relevant decision/VL variants against installed local baselines with pinned test sets. Measure schema-valid **and semantically correct** tool calls, refusal/prompt-injection behavior, document grounding, p50/p95 latency, RAM, battery/CPU, failures and verified task completion. Test license/weights and real hardware before making a capability claim.

**Recommendation:** Read-only feasibility review and approval-gated local benchmark only. No model installation, default promotion, provider routing, billing, or node policy change without explicit approval.
