# Code-First Chat Routing

CoOperative treats deterministic code as the default response layer for every main-chat turn.

## Core rule

1. Resolve saved state, scope, permissions, settings, and known workflow commands in code.
2. If a deterministic handler can fully fulfill the request, return the answer immediately with `execution: "code"`.
3. Only when code cannot fully fulfill the request may CoOperative create a text/vision AI job.
4. AI escalation still follows the existing hierarchy and gates: owned/local first, eligible strict-free fallback next, paid AI only when allowed, funded, and inside the request spend ceiling.

AI is therefore an escalation capability, not the default first responder.

## Current deterministic coverage

The main chat already handles several flows before AI, including:

- conversational Personal / Business intake;
- personal-vs-business scope clarification;
- business intake and structured saved-state parsing;
- Model Mixer / per-prompt spend commands;
- secure service-connection intent;
- recent failure and media retry guards;
- media request planning, budget checks, and provider gates.

The general code-first responder now uses a dedicated platform FAQ registry plus live saved-state lookups.

Deterministic coverage includes:

- simple greetings and acknowledgements;
- CoOperative identity, capabilities, and platform help;
- the code-first / AI-use policy itself;
- paid-AI balance and paid-AI eligibility;
- Model Mixer, spend-cap, Fast/Quality, and local/cloud routing FAQs;
- Personal vs Business scope and onboarding behavior/status;
- known saved businesses and saved Personal/Business profile facts;
- connected provider/service status;
- authorized Unison node availability;
- recent text/media job status;
- provider-connection and API-key safety guidance;
- media generation, attachment, Recovery Agent, project-work, history, and SFW/NSFW platform FAQs.

Live database lookups are intent-gated. CoOperative only reads business/profile/service/node/job state when the user's question requires that state, rather than querying every subsystem on every chat turn.

Repeated reliable behaviors should continue moving into this deterministic layer instead of becoming new prompt instructions.

## Target unified routing order

The end-state main chat, mobile chat, and profile-with-node chat use the same logical router.

After deterministic code, prefer qualified execution in this order:

1. the signed-in profile's authorized capable personal/business node;
2. other authorized owned/platform zero-marginal-cost compute;
3. eligible strict-free/community execution;
4. paid execution only when it is materially needed, the profile has sufficient funded balance, and the request's spend policy permits it.

Installing a node adds an execution target to the same CoOperative profile/chat. It must not create a separate routing product or bypass the code-first layer.

A node is preferred only for capabilities it actually advertises and while it is healthy/available. If it cannot perform the request, routing may continue to the next allowed zero-cost/free option.

If only a paid qualified route can satisfy the unresolved portion:

- estimate the request cost before execution;
- compare it with available funded profile balance and the request spend ceiling;
- if underfunded, do not execute the paid model;
- return the estimated minimum balance shortfall;
- offer a secure Stripe funding action;
- preserve enough request state to resume after confirmed funding.

No balance means paid models are unavailable, not that CoOperative chat itself is unavailable. Deterministic code and qualified local/free capabilities should continue to work.


**Implemented funding handoff:** when local/free text execution fails and a qualified paid executor exists, CoOperative now evaluates that paid route even when the profile balance is empty. It quotes the estimated request cost, calculates the exact balance shortfall, chooses the smallest configured Stripe top-up that covers it, and persists a resumable funding card in the conversation. No paid execution occurs until the balance is sufficient. After Stripe confirms funding, the original failed job can resume through the same bounded paid-fallback endpoint.

## Unified web/URL access policy

Web settings should belong to the CoOperative profile and behave consistently across browser/mobile/node-assisted chat:

- **Off**: no external web search;
- **Auto**: deterministic routing may search when current external information is needed;
- **Always**: eligible turns may search automatically.

A second code-enforced URL/domain permission layer controls what may be accessed. Known provider/OAuth domains use registered connectors; private/authenticated resources require authorization; elevated-risk/local-network/download URLs follow explicit policy rather than model discretion.


**Implemented profile policy foundation:** `personal_ai_settings.web_access_mode` now stores Off / Auto / Always with Off as the default. Main chat, mobile Personal AI, and the authenticated Windows local chat read/write the same profile setting. A server URL classifier blocks unsafe schemes, local/private-network targets, credential-bearing URLs, executable/package downloads, and connector-managed auth/key URLs from ordinary browsing. The Windows web-search helper also filters unsafe result URLs and refuses to send credential-like prompts to an external search service.

For profile-matched Windows text-node execution, the claim API supplies the current Web mode to the node. Auto searches only when deterministic current-info triggers match; Always permits eligible public search. Search results are provided as untrusted current context to the local model, so inference remains on the user's PC.

## Escalation contract

The general code-first responder returns either:

- **handled**: code can fully satisfy the request and no AI job should be created; or
- **AI needed**: code cannot fully satisfy the request without guessing, semantic interpretation, creative generation, synthesis, or a quality loss.

The fallback reason is carried into the AI job route metadata so it remains clear why model reasoning was invoked.

## Design constraint

Do not move a request to AI merely because it is phrased conversationally. Natural-language requests that map safely to known state or a deterministic workflow should stay in code.

Likewise, do not force code to fabricate an answer. If deterministic state and rules are insufficient, escalate only the unresolved portion to AI.


## Capability-registry pattern

Fixed platform answers live in `lib/runtime/platform-faq.ts`. Each FAQ has a narrow intent matcher and a deterministic answer function. Questions that require current account state declare a data requirement first; the chat route loads only the required state and passes it to the same registry.

This keeps platform behavior auditable and prevents the main chat route from accumulating broad prompt rules or unsafe catch-all keyword handlers.
