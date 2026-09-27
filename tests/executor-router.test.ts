import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requiresApprovalBeforeDispatch,
  selectExecutor,
} from "../lib/operative/executor-router.ts";
import type {
  ExecutorCandidate,
  ExecutorRequirements,
} from "../lib/domain/operative-schemas.ts";

function candidate(
  overrides: Partial<ExecutorCandidate> & Pick<ExecutorCandidate, "kind">,
): ExecutorCandidate {
  return {
    available: true,
    qualified: true,
    capabilities: [],
    estimatedMarginalCostMicrounits: 0,
    requiresAutonomousExecution: false,
    riskLevel: "low",
    ...overrides,
  };
}

function requirements(
  overrides: Partial<ExecutorRequirements> = {},
): ExecutorRequirements {
  return {
    requiredCapabilities: [],
    requiresAutonomousExecution: false,
    minimumQualityScore: 0,
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

test("preserves legacy bootstrap behavior when autonomy is carried on candidates", () => {
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

test("capability-based routing allows a cheaper approved external agent to satisfy autonomous work", () => {
  const task = requirements({
    requiredCapabilities: ["browser-automation", "research"],
    requiresAutonomousExecution: true,
  });

  const result = selectExecutor(
    [
      candidate({
        kind: "hermes-cloud-operative",
        providerKey: "hermes",
        capabilities: [
          "reasoning",
          "research",
          "browser-automation",
          "shell",
          "autonomous-execution",
          "persistent-workspace",
          "verification",
        ],
        estimatedMarginalCostMicrounits: 75,
      }),
      candidate({
        kind: "external-ai-provider",
        providerKey: "general-agent-runtime",
        capabilities: [
          "reasoning",
          "research",
          "browser-automation",
          "autonomous-execution",
          "persistent-workspace",
          "verification",
        ],
        estimatedMarginalCostMicrounits: 30,
      }),
    ],
    task,
  );

  assert.equal(result.selected?.providerKey, "general-agent-runtime");
});

test("deterministic code still wins when the task does not require agent-only capabilities", () => {
  const result = selectExecutor(
    [
      candidate({
        kind: "deterministic-code",
        capabilities: ["deterministic", "verification"],
        estimatedMarginalCostMicrounits: 0,
      }),
      candidate({
        kind: "external-ai-provider",
        providerKey: "general-agent-runtime",
        capabilities: [
          "reasoning",
          "research",
          "browser-automation",
          "autonomous-execution",
        ],
        estimatedMarginalCostMicrounits: 1,
      }),
    ],
    requirements({ requiredCapabilities: ["verification"] }),
  );

  assert.equal(result.selected?.kind, "deterministic-code");
});

test("quality floor filters out cheaper candidates that do not meet the requirement", () => {
  const result = selectExecutor(
    [
      candidate({
        kind: "external-ai-provider",
        providerKey: "cheap-agent",
        capabilities: ["reasoning", "research"],
        qualityScore: 0.75,
        estimatedMarginalCostMicrounits: 5,
      }),
      candidate({
        kind: "hermes-cloud-operative",
        providerKey: "hermes",
        capabilities: ["reasoning", "research"],
        qualityScore: 0.93,
        estimatedMarginalCostMicrounits: 20,
      }),
    ],
    requirements({
      requiredCapabilities: ["research"],
      minimumQualityScore: 0.9,
    }),
  );

  assert.equal(result.selected?.providerKey, "hermes");
});

test("hard marginal-cost cap fails closed when every qualified executor is too expensive", () => {
  const result = selectExecutor(
    [
      candidate({
        kind: "external-ai-provider",
        capabilities: ["reasoning", "research"],
        estimatedMarginalCostMicrounits: 40,
      }),
    ],
    requirements({
      requiredCapabilities: ["research"],
      maxMarginalCostMicrounits: 25,
    }),
  );

  assert.equal(result.selected, null);
});

test("medium/high risk candidates require approval before dispatch, low risk does not", () => {
  assert.equal(
    requiresApprovalBeforeDispatch(
      candidate({ kind: "deterministic-code", riskLevel: "low" }),
    ),
    false,
  );
  assert.equal(
    requiresApprovalBeforeDispatch(
      candidate({ kind: "hermes-cloud-operative", riskLevel: "medium" }),
    ),
    true,
  );
  assert.equal(
    requiresApprovalBeforeDispatch(
      candidate({ kind: "external-ai-provider", riskLevel: "high" }),
    ),
    true,
  );
});
