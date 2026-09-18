# Human Provider Browser Handoff

CoOperative should keep human-only provider setup inside a guided owner flow without collecting provider passwords or bypassing MFA/KYC.

## Rules

1. CoOperative may show a provider page inside its browser panel only when the provider permits framing.
2. Authentication, MFA, CAPTCHA, KYC, consent, and developer-account approval remain human actions.
3. If the provider blocks framing or login cookies fail, CoOperative opens a dedicated top-level provider window/tab and keeps the CoOperative setup session waiting behind it.
4. CoOperative never reads cross-origin provider page contents, passwords, MFA codes, or session cookies.
5. Provider-generated secrets are not stored in the project manifest, task text, logs, or Hermes context.
6. Secret injection is a separate owner-gated broker operation. Until that broker is explicitly connected, the UI records only which environment-variable names are required.
7. After the owner returns, CoOperative runs deterministic health checks where available before escalating to Hermes.

This gives the owner a contained setup workflow while preserving provider security requirements and CoOperative's explicit secret gate.
