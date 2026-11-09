# CoOperative Embedded Chat — Apex consumer v1

This **review-only** integration demonstrates CoOperative as a deterministic text-only capability provider for an external app. It intentionally does not invoke the owner chat, Hermes, media, AI inference, any payment method, or charged models.

Endpoint: \`POST /api/embed/apex/chat\`, server-to-server only, with \`Authorization: Bearer <shared-secret>\`. Set \`COOPERATIVE_APEX_EMBED_TOKEN\` (random, at least 32 characters) on the CoOperative server and use the same secret as \`COOPERATIVE_APEX_CHAT_TOKEN\` on Apex. Apex also requires \`COOPERATIVE_APEX_CHAT_URL\` with the full HTTPS endpoint. Never expose tokens via \`NEXT_PUBLIC_\`.

Payload: \`{version:1,message:string,catalogState:"connected"|"disabled"|"unconfigured"|"unavailable",products:PublicProduct[]}\`. Maximum message length 300 chars, max 72 public products, 55 KB request. The Apex server, **not** CoOperative, queries the independently approved public Apex catalog with no private user or supplier context. CoOperative receives no account identity, private database fields, internal costs, or permission to write. Freeform visitor messages may themselves include personal information; users should avoid entering sensitive details. Invalid, unauthorized, or unconfigured calls fail closed.

Successful responses return \`{answer,items,link?,source:"cooperative-code-v1"}\`. Apex revalidates content and internal links. CoOperative has no authority over marketplace authorization or pricing: it only formats an allowed snapshot.

Run: \`node --test tests/apex-embed.test.mjs\`. Until a cross-deployment authenticated smoke test passes, label the integration as configured-ready rather than live-connected. This endpoint is deliberately deterministic and $0 model cost; adding a model requires separate spend caps, rate limiting, governance, and tests.

Future consumer capabilities should follow the same rule: customer/store/supplier access is verified by the **calling platform**; all consequential writes require scoped server-side authorization, preview, confirmation, audit, and release-gate enforcement.
