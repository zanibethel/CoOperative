import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  clampRequestedCostCap,
  estimatePromptTokens,
  getAiAllowance,
  normalizeAiPlan,
  parseLedgerTokenUsage,
} from "../lib/operative/ai-usage-policy.ts";

test("regular users receive plan limits while owners receive owner limits", () => {
  assert.equal(normalizeAiPlan(undefined, false), "free");
  assert.equal(normalizeAiPlan("starter", false), "starter");
  assert.equal(normalizeAiPlan("pro", false), "pro");
  assert.equal(normalizeAiPlan("pro", true), "owner");

  const free = getAiAllowance("free");
  const owner = getAiAllowance("owner");
  assert.ok(free.requestTokenCap > 0);
  assert.ok(free.monthlyTokenCap > free.requestTokenCap);
  assert.ok(owner.requestTokenCap >= free.requestTokenCap);
  assert.ok(owner.hardCostCapUsd >= owner.defaultCostCapUsd);
});

test("client cost requests cannot bypass server plan caps", () => {
  const free = getAiAllowance("free");
  assert.equal(clampRequestedCostCap(999, free, false), free.defaultCostCapUsd);

  const owner = getAiAllowance("owner");
  assert.equal(
    clampRequestedCostCap(owner.hardCostCapUsd * 10, owner, true),
    owner.hardCostCapUsd,
  );
});

test("ledger token notes are counted only for Ask AI entries", () => {
  assert.equal(
    parseLedgerTokenUsage(JSON.stringify({ kind: "console-ask-ai", totalTokens: 321 })),
    321,
  );
  assert.equal(parseLedgerTokenUsage(JSON.stringify({ kind: "other", totalTokens: 999 })), 0);
  assert.equal(parseLedgerTokenUsage("not-json"), 0);
  assert.ok(estimatePromptTokens("hello world") > 0);
});

test("Ask AI UI hides cost controls unless server marks the user as manager", () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), "app/console/page.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/console/ask-ai/route.ts"),
    "utf8",
  );

  assert.match(page, /overview\.aiPolicy\?\.canManageAiLimits \? \(/);
  assert.match(page, /Ask AI/);
  assert.match(page, /Quick Ask/);
  assert.match(route, /clampRequestedCostCap/);
  assert.match(route, /monthlyTokenCap/);
  assert.match(route, /max_tokens: maxOutputTokens/);
  assert.match(route, /cost_ledger_entries/);
});
