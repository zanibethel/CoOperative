import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  INTEGRATION_COMPATIBILITY_RULES,
} from "../lib/operative/integration-compatibility-registry.ts";
import { reviewCompatibilityKnowledge } from "../lib/operative/compatibility-review.ts";
import {
  cloudPlaybookKeys,
  getCloudPlaybook,
} from "../lib/operative/playbook-registry.ts";

test("compatibility registry has unique durable rule ids and complete lessons", () => {
  const ids = INTEGRATION_COMPATIBILITY_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const rule of INTEGRATION_COMPATIBILITY_RULES) {
    assert.equal(rule.status, "active");
    assert.ok(rule.targets.length > 0);
    assert.ok(rule.appliesTo.trim().length > 0);
    assert.ok(rule.symptom.trim().length > 0);
    assert.ok(rule.rootCause.trim().length > 0);
    assert.ok(rule.knownGoodPattern.trim().length > 0);
    assert.ok(rule.enforcementPaths.length > 0);
  }
});

test("initial Cloud Hermes roadblocks are preserved as reusable rules", () => {
  const ids = new Set(INTEGRATION_COMPATIBILITY_RULES.map((rule) => rule.id));
  for (const id of [
    "executor-canonical-hermes-name",
    "workflow-oidc-use-helper",
    "sandbox-shell-statements-must-be-separated",
    "sandbox-staged-source-has-no-git-metadata",
    "workflow-required-for-long-cloud-work",
    "hermes-v0213-global-flags-before-subcommand",
    "hermes-v0213-scripted-oneshot-turn-limit-via-env",
    "hermes-v0213-minimum-context-64k",
    "hermes-v0213-usage-file-requires-scripted-oneshot",
    "ai-gateway-unknown-cost-must-not-equal-zero",
    "hermes-prompt-size-diagnostic-must-be-bounded",
    "prepared-hermes-runtime-reuse",
    "linked-project-use-own-revision",
    "provider-auth-use-human-handoff",
    "linked-hermes-patch-review-before-write",
    "secret-value-request-only-after-owner-approval",
    "vercel-env-change-requires-new-deployment",
    "provider-secrets-never-enter-agent-context",
    "linked-hermes-paid-step-no-auto-retry",
    "linked-hermes-timeout-split-scope",
    "linked-hermes-deterministic-whitespace-repair-first",
    "linked-hermes-preserve-invalid-patch-evidence",
    "linked-hermes-detach-long-sandbox-process",
    "linked-hermes-bounded-phase-timeout-fix-worker",
    "supabase-trusted-writes-preserve-owner-gates",
  ]) {
    assert.ok(ids.has(id), `missing compatibility rule: ${id}`);
  }
});

test("every allow-listed playbook passes compatibility coverage before execution", () => {
  for (const key of cloudPlaybookKeys()) {
    const playbook = getCloudPlaybook(key);
    assert.ok(playbook);
    assert.ok(playbook.compatibilityTargets.length > 0);

    const review = reviewCompatibilityKnowledge(playbook.compatibilityTargets);
    assert.equal(review.ok, true, `${key}: ${review.uncoveredTargets.join(", ")}`);
    assert.deepEqual(review.uncoveredTargets, []);
    assert.ok(review.ruleIds.length > 0);
    assert.ok(review.brief.length > 0);
  }
});

test("task execution fails closed on compatibility review before executor dispatch", () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), "app/api/operative/tasks/[id]/execute/route.ts"),
    "utf8",
  );

  const reviewIndex = routeSource.indexOf("reviewCompatibilityKnowledge");
  const blockIndex = routeSource.indexOf("COMPATIBILITY_REVIEW_REQUIRED");
  const executorIndex = routeSource.indexOf('event_type: "executor_selected"');

  assert.ok(reviewIndex >= 0);
  assert.ok(blockIndex > reviewIndex);
  assert.ok(executorIndex > blockIndex);
  assert.match(routeSource, /type: "compatibility_review"/);
  assert.match(routeSource, /compatibilityRuleIds/);
});

test("Hermes receives the reviewed compatibility brief before model execution", () => {
  const workflowSource = fs.readFileSync(
    path.join(process.cwd(), "lib/workflow/hermes-model-smoke.ts"),
    "utf8",
  );

  assert.match(workflowSource, /Compatibility knowledge review is required before Hermes model execution/);
  assert.match(workflowSource, /input\.compatibilityReview\.brief/);
  assert.match(workflowSource, /compatibilityRuleIds/);
});
