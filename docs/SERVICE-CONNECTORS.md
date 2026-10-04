# Code-First Third-Party Service Connectors

CoOperative treats third-party account connections as a deterministic platform capability.

## Core rule

A user's request to connect, link, authorize, sign in to, or configure a supported third-party service is handled by code first.

AI should not be invoked merely to explain how to connect a provider, generate a sign-in URL, collect a credential, check connection status, refresh an OAuth grant, or perform a known provider action.

## Connection lifecycle

1. Parse the connection request in code.
2. Match it against the shared connector registry.
3. If the connector is implemented:
   - OAuth/OIDC connectors launch the approved authorization endpoint/card.
   - API-key connectors launch the secure credential card.
   - credentials and authorization state never pass through ordinary chat or an AI prompt.
4. If the provider is known but its connector is not implemented, code creates or reuses a bounded connector-build task.
5. If the provider is not known, code records it as a research-stage provider and creates the same bounded build task.
6. AI/Repo Engineer may research public provider documentation and prepare the missing reusable connector.
7. The prepared connector must be tested and reviewed before it is promoted to the shared registry as available.
8. Once promoted, future users receive the same code-first authorization flow without needing AI to rediscover or rebuild it.

## Shared registry

The connector registry is defined in:

- `lib/runtime/service-connector-registry.ts`

Each entry declares:

- provider key and display name;
- aliases used for deterministic intent matching;
- authorization kind;
- whether implementation is `available` or `build-required`;
- connector endpoint when available;
- optional credential-management URL.

Current implemented routes include:

- Nous Portal OAuth/device authorization;
- OpenRouter API key;
- OpenAI API key;
- Anthropic/Claude API key;
- Google Gemini API key.

Known providers currently marked for connector building include Google Workspace, QuickBooks Online, Shopify, Square, and GlossGenius.

## Missing connector builder

Missing connectors are delegated to the existing Repo Engineer task system with a tightly bounded objective.

The builder may:

- research current public API/OAuth documentation;
- determine the supported authentication method;
- prepare reusable connector code;
- define minimal scopes;
- add tests and verification;
- prepare registry promotion changes.

The builder may not:

- request or read a user's password, API key, OAuth code, token, cookie, or secret;
- receive credentials through a model prompt;
- authorize an account for the user;
- weaken authentication, RLS, vault, or provider scope rules;
- merge, deploy, change production secrets, or automatically promote a connector.

The user authorizes their provider account only after the connector exists.

## Promotion requirements

A connector becomes `available` only when all required pieces are present:

1. deterministic request matching;
2. approved authentication method;
3. server-side connection/status implementation;
4. encrypted credential/token storage where applicable;
5. refresh/reconnect behavior where applicable;
6. least-privilege scope list;
7. error/revocation handling;
8. verification/tests;
9. owner review;
10. registry promotion.

This creates a flywheel: one user's missing integration can trigger connector preparation, and once approved, every later user benefits from the code path rather than paying for repeated AI reasoning.
