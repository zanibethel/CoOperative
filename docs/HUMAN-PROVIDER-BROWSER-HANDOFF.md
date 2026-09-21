# Human Provider Browser Handoff

CoOperative should keep human-only provider setup inside a guided owner flow without collecting provider passwords or bypassing MFA/KYC.

## Rules

1. CoOperative may show a provider page inside its browser panel only when the provider permits framing.
2. Authentication, MFA, CAPTCHA, KYC, consent, and developer-account approval remain human actions.
3. If the provider blocks framing or login cookies fail, CoOperative opens a dedicated top-level provider window/tab and keeps the CoOperative setup session waiting behind it.
4. CoOperative never reads cross-origin provider page contents, passwords, MFA codes, or session cookies.
5. Provider-generated secrets are not stored in the project manifest, task text, logs, or Hermes context.
6. Secret injection is a separate owner-gated broker operation. Until that broker is explicitly connected, the UI records only which environment-variable names are required.
7. When an embedded browser cannot complete provider authentication (including Google sign-in restrictions), the handoff must use a top-level browser and persist a local resume marker before leaving CoOperative.
8. On return, CoOperative restores the pending provider setup and resumes at the exact reviewed next step. If the provider generated a secret, the UI scrolls to that allow-listed broker key rather than asking the owner to rediscover where it belongs.
9. A website's "Sign in with Google" is not assumed to be API OAuth. CoOperative only exchanges OAuth authorization codes when the provider has a verified integration OAuth flow and callback contract. Otherwise, Google/provider sign-in remains the human browser checkpoint and the provider's documented API/MCP credential is brokered separately.
10. After required credentials are available, CoOperative runs deterministic health checks where available before escalating to Hermes.

## Resume modes

- **local-session** — for provider website sign-in/setup flows. CoOperative keeps no provider password, cookie, or MFA data; it only remembers which reviewed setup step is waiting.
- **oauth-callback** — for providers with a verified OAuth integration contract. CoOperative will use provider state/callback validation and server-side token exchange rather than asking the owner to copy tokens.
- **owner-paste-to-broker** — the provider creates a key/token and the owner pastes it once into the allow-listed secret broker. The value is sent directly to the target secret store and is not retained in CoOperative task text or Hermes context.
- **oauth-token-exchange** — the provider callback yields a short-lived authorization code and CoOperative exchanges/stores the resulting credential server-side.

For Eromify today, the reviewed path is **external-browser + local-session + owner-paste-to-broker**. Eromify's Google sign-in authenticates the provider website, while CreatorHub's verified runtime credential remains `EROMIFY_API_KEY`. Generic custom-client OAuth should not be claimed until Eromify exposes and verifies that contract.

This gives the owner a contained setup workflow while preserving provider security requirements and CoOperative's explicit secret gate.
