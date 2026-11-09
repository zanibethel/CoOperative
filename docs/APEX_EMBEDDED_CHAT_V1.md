# CoOperative Embedded Chat — Apex consumer v1

This **review-only** integration demonstrates CoOperative as a deterministic text-only capability provider for an external app. It intentionally does not invoke the owner chat, Hermes, media, AI inference, any payment method, or charged models.

Endpoint: \`POST /api/embed/apex/chat\`, server-to-server only, with \`Authorization: Bearer <shared-secret>\`. Set \`COOPERATIVE_APEX_EMBED_TOKEN\` (random, at least 32 characters) on the CoOperative server and use the same secret as \`COOPERATIVE_APEX_CHAT_TOKEN\` on Apex. Apex also requires \`COOPERATIVE_APEX_CHAT_URL\` with the full HTTPS endpoint. Never expose tokens via \`NEXT_PUBLIC_\`.

Payload: \`{version:1,message:string,catalogState:"connected"|"disabled"|"unconfigured"|"unavailable",products:PublicProduct[]}\`. Maximum message length 300 chars, max 72 public products, 55 KB request. The Apex server, **not** CoOperative, queries the independently approved public Apex catalog with no private user or supplier context. CoOperative receives no account identity, private database fields, internal costs, or permission to write. Freeform visitor messages may themselves include personal information; users should avoid entering sensitive details. Invalid, unauthorized, or unconfigured calls fail closed.

Successful responses return \`{answer,items,link?,source:"cooperative-code-v1"}\`. Apex revalidates content and internal links. CoOperative has no authority over marketplace authorization or pricing: it only formats an allowed snapshot.

Run: \`node --test tests/apex-embed.test.mjs\`. Until a cross-deployment authenticated smoke test passes, label the integration as configured-ready rather than live-connected. This endpoint is deliberately deterministic and $0 model cost; adding a model requires separate spend caps, rate limiting, governance, and tests.

Future consumer capabilities should follow the same rule: customer/store/supplier access is verified by the **calling platform**; all consequential writes require scoped server-side authorization, preview, confirmation, audit, and release-gate enforcement.

## Authenticated preview handshake — November 9, 2026

- The preview-only secret was installed in both Vercel projects, and Apex's preview-only endpoint URL was configured. All three variables are scoped strictly to these two feature branches, not production.
- Apex preview made a server-to-server POST with \`{version:1,message:"hello",catalogState:"unavailable",products:[]}\` using only the encrypted server-side credential.
- Its temporary, preview-only diagnostic returned \`{"connected":true,"status":200,"source":"cooperative-code-v1"}\`. This confirms an actual remote response, not the built-in Apex fallback.
- The diagnostic route was deleted immediately afterward, before merge. The initial GitHub-hosted HTTP smoke test failed with 401 because GitHub Actions was not authorized to enter the protected Vercel preview; it was removed and is not evidence of a service error.
- Both previews previously reported READY. Apex's full quality checks passed on its recent feature commits; confirm checks again after the final cleanup commit. CoOperative's focused embed test passed, while its existing broad CI remains blocked by unrelated lint errors.
- This is evidence for cross-service connectivity and basic text protocol, **not** approval to enable live product release, checkout, supplier mutations, or production credentials. Never set production secrets or merge without the remaining review checks.

## FAQ / zero-model routing update — 2026-11-09

Phase 1 now provides a versioned, reviewable rule bank in \`src/lib/chat/apex-knowledge.mjs\` (mirrored in CoOperative as \`lib/runtime/embed-apex-knowledge.mjs\`). It covers 23 intent families with tested phrasings: greetings, capabilities, bot identity, account access and password recovery, supplier access, draft/product changes and inventory, supplier reports, privacy, discounts, shipping, returns, order tracking, checkout/payment readiness, stock/restock, product-use safety, pricing/tax uncertainty, catalog navigation, public hours/pickup uncertainty, support, and launch timing.

**Request decision path:**
1. Validate size, rate-limit and text; use \`answerApexKnowledge\` first. If matched, answer locally without public catalog I/O or CoOperative network requests.
2. Otherwise use only the existing approved public catalog projection for product search and prices; never use unpublished supplier data or invent prices/stock.
3. Remote CoOperative code-only fallback is disabled unless a server-only \`COOPERATIVE_APEX_REMOTE_FALLBACK=enabled\` flag is explicitly set. The existing remote integration still requires the shared secret and response integrity validation.
4. Unknown or unavailable questions return a bounded, non-generative explanation and public navigation link. There is **no automatic AI/provider escalation** and no model charge by default.
5. Rule ordering is intentional: medical/use refusals, supplier mutations, auth/privacy and transaction limits must precede broad product searches. Update both copies of the rule bank and run each repo's focused tests whenever an intent changes.

**Release truth:** These written replies describe the current checkout-disabled site. Before enabling commerce or shipping, review every claim and change the FAQ along with published policies; do not ship outdated hard-coded checkout/payment claims. Future admin-managed FAQ editing would need an authorization, preview, audit and policy-approval workflow; this PR adds no unsafe public content editing.

**Coverage limits:** No fixed FAQ table can anticipate every user sentence. Misses use a safe local fallback and can be added as tested rules later. Do not add external AI calls just because a pattern was missed.
