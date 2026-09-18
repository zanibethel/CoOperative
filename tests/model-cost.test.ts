import test from "node:test";
import assert from "node:assert/strict";

import { resolveModelCost } from "../lib/operative/model-cost.ts";

test("authoritative provider cost is used when known", () => {
  const cost = resolveModelCost(
    {
      estimated_cost_usd: 0.0042,
      cost_status: "known",
      cost_source: "provider",
      input_tokens: 10,
      output_tokens: 2,
    },
    { input: "0.0000001", output: "0.0000004" },
  );

  assert.equal(cost.source, "hermes-usage");
  assert.equal(cost.status, "reported");
  assert.equal(cost.usd, 0.0042);
  assert.equal(cost.microunits, 4200);
});

test("unknown Hermes cost is estimated from actual tokens and AI Gateway catalog pricing", () => {
  const cost = resolveModelCost(
    {
      estimated_cost_usd: 0,
      cost_status: "unknown",
      cost_source: "none",
      input_tokens: 13018,
      output_tokens: 37,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
    {
      input: "0.0000001",
      output: "0.0000004",
      input_cache_read: "0.00000001",
      input_cache_write: "0.000000125",
    },
  );

  assert.equal(cost.source, "ai-gateway-catalog");
  assert.equal(cost.status, "estimated");
  assert.equal(cost.usd, 0.0013166);
  assert.equal(cost.microunits, 1317);
});

test("unknown cost never silently becomes free", () => {
  assert.throws(
    () =>
      resolveModelCost(
        {
          estimated_cost_usd: 0,
          cost_status: "unknown",
          cost_source: "none",
          input_tokens: 100,
          output_tokens: 10,
        },
        undefined,
      ),
    /refusing to record \$0/,
  );
});

test("provider-varying catalog price fails closed when Hermes cost is unknown", () => {
  assert.throws(
    () =>
      resolveModelCost(
        {
          estimated_cost_usd: 0,
          cost_status: "unknown",
          cost_source: "none",
          input_tokens: 100,
          output_tokens: 10,
        },
        {
          input: "0.0000001",
          output: "0.0000004",
          varies_by_provider: true,
        },
      ),
    /varies by provider/,
  );
});
