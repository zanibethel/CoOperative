import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "lib/workflow/linked-project-hermes.ts"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(process.cwd(), "app/api/operative/tasks/[id]/execute/route.ts"),
  "utf8",
);

test("linked-project Hermes uses prepared cloud runtime and short-lived OIDC", () => {
  assert.match(source, /cooperative-hermes-runtime-v2026-9-14/);
  assert.match(source, /getVercelOidcToken/);
  assert.match(source, /AI_GATEWAY_API_KEY: oidcToken/);
  assert.match(source, /Sandbox\.fork/);
  assert.match(source, /alibaba\/qwen3\.5-flash/);
});

test("linked-project Hermes is file-only and cannot directly deploy or push", () => {
  assert.match(source, /"--toolsets",[\s\S]*?"file"/);
  assert.match(source, /Do not commit, push, open a pull request, or deploy/);
  assert.match(source, /repositoryWritePerformed: false/);
  assert.match(source, /productionChangePerformed: false/);
  assert.match(source, /secretAccessPerformed: false/);
  assert.equal(source.includes('"--yolo"'), false);
  assert.equal(source.includes('"terminal"'), false);
  assert.equal(source.includes('"browser"'), false);
});

test("linked-project Hermes preserves usage, cost and deterministic verification", () => {
  assert.match(source, /--usage-file/);
  assert.match(source, /resolveModelCost/);
  assert.match(source, /actual_spend_microunits: evidence\.costMicrounits/);
  assert.match(source, /cost_ledger_entries/);
  assert.match(source, /git",\s*args: \["diff", "--check"\]/);
  assert.match(source, /playbook\.buildCommands\(\)/);
  assert.match(source, /verificationSucceeded/);
});

test("linked-project Hermes returns a bounded reviewable patch and blocks secret paths", () => {
  assert.match(source, /MAX_PATCH_BYTES = 160_000/);
  assert.match(source, /git",\s*args: \["diff", "--binary", "--no-ext-diff"\]/);
  assert.match(source, /patchTouchesBlockedPath/);
  assert.match(source, /\.vercel/);
  assert.match(source, /\.env/);
});

test("task dispatcher sends project-scoped workflow requests to linked Hermes", () => {
  assert.match(route, /linkedProjectHermesWorkflow/);
  assert.match(route, /playbook\.projectKey/);
  assert.match(route, /request: task\.description/);
  assert.match(route, /maxSpendMicrounits/);
  assert.match(route, /compatibilityReview/);
});
