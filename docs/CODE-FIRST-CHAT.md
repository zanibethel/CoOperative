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
