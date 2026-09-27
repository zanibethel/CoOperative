import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertRuntimeCanAttempt,
  type AgentRuntimeProfile,
} from "../lib/operative/agent-runtime-contract.ts";
import type { ExecutorRequirements } from "../lib/domain/operative-schemas.ts";

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

const approvedRuntime: AgentRuntimeProfile = {
  key: "test-agent",
  name: "Test Agent",
  status: "approved",
  capabilities: [
    "reasoning",
    "research",
    "browser-automation",
    "autonomous-execution",
    "persistent-workspace",
  ],
  supportsSteering: true,
  supportsCancellation: true,
  supportsUsageReporting: true,
  supportsArtifactRetrieval: true,
};

test("approved agent runtime can satisfy declared capabilities", () => {
  assert.doesNotThrow(() =>
    assertRuntimeCanAttempt(
      approvedRuntime,
      requirements({
        requiredCapabilities: ["research", "browser-automation"],
        requiresAutonomousExecution: true,
      }),
    ),
  );
});

test("research-only runtime cannot execute", () => {
  assert.throws(
    () =>
      assertRuntimeCanAttempt(
        { ...approvedRuntime, status: "research" },
        requirements({ requiredCapabilities: ["research"] }),
      ),
    /not approved for execution/,
  );
});

test("runtime fails closed when a required capability is absent", () => {
  assert.throws(
    () =>
      assertRuntimeCanAttempt(
        approvedRuntime,
        requirements({ requiredCapabilities: ["shell"] }),
      ),
    /missing required capabilities: shell/,
  );
});
