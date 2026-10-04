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

The general code-first responder adds deterministic answers for:

- simple greetings and acknowledgements;
- CoOperative identity and capabilities;
- the code-first / AI-use policy itself;
- current paid-AI balance;
- current personal/business scope;
- current local execution preference;
- onboarding status.

This list should expand over time as repeated reliable behaviors become deterministic capabilities.

## Escalation contract

The general code-first responder returns either:

- **handled**: code can fully satisfy the request and no AI job should be created; or
- **AI needed**: code cannot fully satisfy the request without guessing, semantic interpretation, creative generation, synthesis, or a quality loss.

The fallback reason is carried into the AI job route metadata so it remains clear why model reasoning was invoked.

## Design constraint

Do not move a request to AI merely because it is phrased conversationally. Natural-language requests that map safely to known state or a deterministic workflow should stay in code.

Likewise, do not force code to fabricate an answer. If deterministic state and rules are insufficient, escalate only the unresolved portion to AI.
