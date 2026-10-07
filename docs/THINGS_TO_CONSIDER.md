# Things to Consider — CoOperative

Living backlog of external findings, possible upgrades, and solution ideas that may improve CoOperative.

These are **not approved implementation tasks**. Each item should be re-validated against the current codebase, current provider/docs state, cost, security, and product goals before implementation. Move an item forward only after explicit user approval.

Last reviewed: 2026-10-07

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

**Status:** Recommend / partial implementation evidence  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-07  
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

### Recommendation
Implement only after reviewing the complete quote/debit/markup path so quoted cost, reserved cost, actual provider cost, and user deduction remain reconcilable.

---

## 4. Structured project intelligence instead of chat-memory-only state

**Status:** Implemented foundation / Recommend verification receipts  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-07  
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

### Recommendation
Keep `docs/THINGS_TO_CONSIDER.md` for unapproved opportunities and `docs/PROJECT_INTELLIGENCE.md` for the standard "what's new?" workflow. Add deterministic completion receipts to cross-device task verification before treating a claimed action as complete.

Reference: https://openai.com/index/ironclad/

Reference: https://tldr.tech/dev/2026-10-05


---

## 5. Mistral Large 4 as a registry and routing candidate

**Status:** Evaluate after preview validation  
**Added:** 2026-10-06  
**Last reviewed:** 2026-10-06  
**Source:** Mistral AI documentation / Reuters

### Finding
Mistral Large 4 entered public preview on 2026-10-06 as an open-weight, multimodal Mixture-of-Experts model with a 1M-token context window. Mistral documents structured outputs, function calling, document Q&A, agent/conversation endpoints, and hosted pricing. Reuters reports that the full public release is planned for 2026-10-27.

### Why it may matter
It may become useful for:
- high-context research and synthesis;
- multimodal/document work;
- structured agent calls;
- open-weight or self-hosted deployment;
- an additional replaceable provider route.

The model is too large for the current Mac/CPU-class local nodes, so near-term value is hosted/provider routing rather than default local execution.

### Possible solution
Let the existing daily model-registry scan discover provider availability. Add explicit capability evidence only from official model/provider metadata, then run the standard cost, latency, tool-call, refusal, safety, and quality eval set.

### Recommendation
Do not add it to default production routing during preview. Evaluate after availability and pricing stabilize, with a targeted recheck after the planned 2026-10-27 full release.

References:
- https://docs.mistral.ai/models/mistral-large-4-0
- https://www.reuters.com/world/china/mistral-ceo-says-new-ai-model-beats-chinese-ones-some-areas-2026-10-06/

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
