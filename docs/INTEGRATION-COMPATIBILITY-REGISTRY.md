# Integration Compatibility Registry

CoOperative treats integration failures as durable system knowledge, not disposable debugging.

Before an allow-listed playbook may start deterministic code, shell work, or an AI executor, it must declare the integration targets it touches. The execution route runs a deterministic compatibility preflight against `lib/operative/integration-compatibility-registry.ts`.

## Contract

1. Every reviewed playbook declares `compatibilityTargets`.
2. Every declared target must have at least one active compatibility rule.
3. An uncovered target fails closed with `COMPATIBILITY_REVIEW_REQUIRED`.
4. The preflight result is written to the canonical task event stream before execution.
5. AI-backed Hermes work receives the reviewed compatibility brief in its fixed prompt/context.
6. Each learned roadblock should become:
   - a version-aware registry rule;
   - a deterministic known-good pattern;
   - an avoid-pattern;
   - regression coverage or an enforcement path.
7. Old rules are revalidated when component versions change rather than silently assumed to remain true.

This creates the intended learning loop:

**diagnose once → prove the fix → register the rule → add regression coverage → preflight it automatically → do not pay an AI to rediscover it.**

The initial registry is seeded from the Cloud Hermes bootstrap roadblocks discovered on 2026-09-18.
