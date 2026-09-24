import test from "node:test";
import assert from "node:assert/strict";

import {
  isHermesModelAvailabilityFailure,
  routeHermesModels,
} from "../lib/operative/hermes-model-router.ts";

test("standard Hermes routing starts with the low-cost approved model", () => {
  const route = routeHermesModels("standard");
  assert.equal(route.candidates[0], "openai/gpt-5.6-luna");
  assert.ok(route.candidates.includes("openai/gpt-5.6-sol"));
});

test("advanced Hermes routing preserves the stronger quality floor", () => {
  const route = routeHermesModels("advanced");
  assert.deepEqual(route.candidates, ["openai/gpt-5.6-sol"]);
});

test("availability failures are distinguishable from task failures", () => {
  assert.equal(
    isHermesModelAvailabilityFailure(
      "HTTP 503: Model is temporarily unavailable (no price is registered)",
    ),
    true,
  );
  assert.equal(
    isHermesModelAvailabilityFailure("TypeScript compilation failed"),
    false,
  );
});
