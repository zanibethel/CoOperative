import test from "node:test";
import assert from "node:assert/strict";

import { evaluateOwnerTaskPolicy, OwnerTaskIntentSchema } from "../lib/operative/task-policy.ts";

test("low-risk owner task stays low-risk and does not require approval", () => {
  const intent = OwnerTaskIntentSchema.parse({
    title: "Review RaiseHub docs",
    description: "Read-only review and report.",
    maxSpendUsd: 0,
  });

  const result = evaluateOwnerTaskPolicy(intent);

  assert.equal(result.riskLevel, "low");
  assert.equal(result.requiresOwnerApproval, false);
  assert.equal(result.maxSpendMicrounits, 0);
});

test("shell-only task is medium risk but does not automatically require an owner gate", () => {
  const intent = OwnerTaskIntentSchema.parse({
    title: "Run preview tests",
    maxSpendUsd: 1.25,
    flags: { requiresShell: true },
  });

  const result = evaluateOwnerTaskPolicy(intent);

  assert.equal(result.riskLevel, "medium");
  assert.equal(result.requiresOwnerApproval, false);
  assert.equal(result.maxSpendMicrounits, 1_250_000);
  assert.deepEqual(result.reasons, ["shell/runtime execution"]);
});

test("production, secret, database, money, and destructive flags cannot silently bypass approval", () => {
  for (const flag of [
    "changesProduction",
    "touchesSecrets",
    "changesDatabase",
    "movesMoney",
    "destructive",
  ] as const) {
    const intent = OwnerTaskIntentSchema.parse({
      title: `Guarded task: ${flag}`,
      flags: { [flag]: true },
    });

    const result = evaluateOwnerTaskPolicy(intent);

    assert.equal(result.requiresOwnerApproval, true, flag);
    assert.ok(result.riskLevel === "medium" || result.riskLevel === "high", flag);
  }
});

test("high-risk flags resolve to high risk", () => {
  const intent = OwnerTaskIntentSchema.parse({
    title: "Apply a database migration",
    flags: { changesDatabase: true },
  });

  const result = evaluateOwnerTaskPolicy(intent);

  assert.equal(result.riskLevel, "high");
  assert.equal(result.requiresOwnerApproval, true);
  assert.deepEqual(result.reasons, ["database change"]);
});


test("targeted repair lineage is explicit task metadata and does not bypass existing gates", () => {
  const intent = OwnerTaskIntentSchema.parse({
    title: "Repair preserved CreatorHub patch",
    repairSourceTaskId: "11111111-1111-4111-8111-111111111111",
    maxSpendUsd: 0.02,
    flags: { requiresShell: true },
  });

  const result = evaluateOwnerTaskPolicy(intent);

  assert.equal(intent.repairSourceTaskId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.riskLevel, "medium");
  assert.equal(result.requiresOwnerApproval, false);
  assert.equal(result.maxSpendMicrounits, 20_000);
});
