# Things to Consider — CoOperative

Living backlog of external findings, possible upgrades, and solution ideas that may improve CoOperative.

These are **not approved implementation tasks**. Each item should be re-validated against the current codebase, current provider/docs state, cost, security, and product goals before implementation. Move an item forward only after explicit user approval.

Last reviewed: 2026-10-05

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

**Status:** Recommend  
**Added:** 2026-10-05  
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

### Recommendation
Implement after reviewing the existing quote/debit/markup path so quoted cost, reserved cost, actual provider cost, and user deduction remain reconcilable.

---

## 4. Structured project intelligence instead of chat-memory-only state

**Status:** Recommend  
**Added:** 2026-10-05  
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

### Recommendation
Use `docs/THINGS_TO_CONSIDER.md` for unapproved opportunities and `docs/PROJECT_INTELLIGENCE.md` for the standard "what's new?" workflow.

Reference: https://tldr.tech/dev/2026-10-05
