import { test } from "node:test";
import assert from "node:assert/strict";
import { selectExecutor, requiresApprovalBeforeDispatch } from "../lib/operative/executor-router.ts";
import type { ExecutorCandidate } from "../lib/domain/operative-schemas.ts";

function candidate(overrides: Partial<ExecutorCandidate> & Pick<ExecutorCandidate, "kind">): ExecutorCandidate {
  return {
    available: true,
    qualified: true,
    estimatedMarginalCostMicrounits: 0,
    requiresAutonomousExecution: false,
    riskLevel: "low",
    ...overrides,
  };
}

test("prefers deterministic code when it is free and qualified", () => {
  const result = selectExecutor([
    candidate({ kind: "deterministic-code", estimatedMarginalCostMicrounits: 0 }),
    candidate({ kind: "connected-chatgpt", estimatedMarginalCostMicrounits: 0 }),
    candidate({ kind: "external-ai-provider", estimatedMarginalCostMicrounits: 50 }),
  ]);
  assert.equal(result.selected?.kind, "deterministic-code");
});

test("prefers connected ChatGPT over paid external AI when both qualified and ChatGPT is free (flat-rate)", () => {
  const result = selectExecutor([
    candidate({ kind: "connected-chatgpt", estimatedMarginalCostMicrounits: 0 }),
    candidate({ kind: "external-ai-provider", estimatedMarginalCostMicrounits: 30 }),
  ]);
  assert.equal(result.selected?.kind, "connected-chatgpt");
});

test("lowest marginal cost wins even if it is not the priority-first kind", () => {
  const result = selectExecutor([
    candidate({ kind: "native-capability", estimatedMarginalCostMicrounits: 5 }),
    candidate({ kind: "connected-chatgpt", estimatedMarginalCostMicrounits: 1 }),
  ]);
  assert.equal(result.selected?.kind, "connected-chatgpt");
});

test("unavailable or unqualified candidates are never selected", () => {
  const result = selectExecutor([
    candidate({ kind: "deterministic-code", available: false }),
    candidate({ kind: "connected-chatgpt", qualified: false }),
    candidate({ kind: "external-ai-provider", estimatedMarginalCostMicrounits: 20 }),
  ]);
  assert.equal(result.selected?.kind, "external-ai-provider");
});

test("returns null selection when nothing is eligible", () => {
  const result = selectExecutor([
    candidate({ kind: "deterministic-code", available: false }),
    candidate({ kind: "connected-chatgpt", qualified: false }),
  ]);
  assert.equal(result.selected, null);
});

test("tasks requiring autonomous execution can only be satisfied by hermes-cloud-operative", () => {
  const result = selectExecutor([
    candidate({
      kind: "connected-chatgpt",
      estimatedMarginalCostMicrounits: 0,
      requiresAutonomousExecution: true,
    }),
    candidate({
      kind: "hermes-cloud-operative",
      estimatedMarginalCostMicrounits: 10,
      requiresAutonomousExecution: true,
    }),
  ]);
  assert.equal(result.selected?.kind, "hermes-cloud-operative");
});

test("autonomy requirement with no qualified hermes candidate yields no selection", () => {
  const result = selectExecutor([
    candidate({
      kind: "connected-chatgpt",
      estimatedMarginalCostMicrounits: 0,
      requiresAutonomousExecution: true,
    }),
  ]);
  assert.equal(result.selected, null);
});

test("medium/high risk candidates require approval before dispatch, low risk does not", () => {
  assert.equal(requiresApprovalBeforeDispatch(candidate({ kind: "deterministic-code", riskLevel: "low" })), false);
  assert.equal(requiresApprovalBeforeDispatch(candidate({ kind: "hermes-cloud-operative", riskLevel: "medium" })), true);
  assert.equal(requiresApprovalBeforeDispatch(candidate({ kind: "external-ai-provider", riskLevel: "high" })), true);
});
