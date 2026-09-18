import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workflowSource = fs.readFileSync(
  path.join(process.cwd(), "lib/workflow/hermes-model-smoke.ts"),
  "utf8",
);
const consoleSource = fs.readFileSync(
  path.join(process.cwd(), "app/console/page.tsx"),
  "utf8",
);

test("model smoke uses short-lived Vercel OIDC for AI Gateway", () => {
  assert.match(workflowSource, /VERCEL_OIDC_TOKEN/);
  assert.match(workflowSource, /AI_GATEWAY_API_KEY:\s*oidcToken/);
  assert.equal(workflowSource.includes("NOUS_API_KEY"), false);
  assert.equal(workflowSource.includes("SUPABASE_SECRET_KEY"), false);
});

test("model smoke is single-turn and bounded", () => {
  assert.match(workflowSource, /--max-turns 1/);
  assert.match(workflowSource, /--run-budget 60/);
  assert.match(workflowSource, /timeout 75s/);
  assert.match(workflowSource, /--safe-mode/);
  assert.match(workflowSource, /--ignore-user-config/);
  assert.match(workflowSource, /--ignore-rules/);
});

test("model smoke uses usage-file accounting and enforces task cap", () => {
  assert.match(workflowSource, /--usage-file \/tmp\/hermes-usage\.json/);
  assert.match(workflowSource, /total_including_auxiliary/);
  assert.match(workflowSource, /Cost Governor violation/);
  assert.match(workflowSource, /actual_spend_microunits/);
});

test("Owner Console makes the paid smoke test explicit and tiny", () => {
  assert.match(consoleSource, /maxSpendUsd:\s*0\.02/);
  assert.match(consoleSource, /max \$0\.02/);
  assert.match(consoleSource, /No persistent provider key/);
});
