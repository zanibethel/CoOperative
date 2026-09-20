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
  assert.match(source, /HERMES_MAX_ITERATIONS: String\(MAX_TURNS\)/);
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
  assert.equal(source.includes('"--max-turns"'), false);
  assert.equal(source.includes('"--run-budget"'), false);
  assert.equal(source.includes('"--checkpoints"'), false);
  assert.equal(source.includes('"--source"'), false);
  assert.match(source, /timeout 300s/);
  assert.match(source, /new TextEncoder\(\)\.encode\(value\)\.byteLength/);
  assert.equal(source.includes("Buffer.byteLength"), false);
  assert.match(source, /export TERMINAL_CWD=/);
  assert.match(source, /Repository root: /);
  assert.match(source, /Prefer absolute paths under/);
});

test("task dispatcher sends project-scoped workflow requests to linked Hermes", () => {
  assert.match(route, /linkedProjectHermesWorkflow/);
  assert.match(route, /playbook\.projectKey/);
  assert.match(route, /request: task\.description \|\| task\.title/);
  assert.match(route, /maxSpendMicrounits/);
  assert.match(route, /compatibilityReview/);
  assert.match(route, /MODEL_SPEND_CAP_REQUIRED/);
});


test("failed Hermes execution still preserves metered evidence before final status", () => {
  assert.match(source, /hermesExitCode/);
  assert.match(source, /hermesError/);
  assert.match(source, /Usage\/cost evidence and any partial patch were preserved/);
  assert.match(source, /amount_microunits: evidence\.costMicrounits/);
});


test("linked-project Hermes finalization records verifying state and avoids duplicate cost rows on replay", () => {
  assert.match(source, /status: "verifying"/);
  assert.match(source, /from_status: "executing"/);
  assert.match(source, /to_status: "verifying"/);
  assert.match(source, /select\("id,executor,cost_category"\)/);
  assert.match(source, /existingKeys\.has\("hermes-cloud-operative:ai-tokens"\)/);
  assert.match(source, /existingKeys\.has\("vercel-sandbox:sandbox-compute"\)/);
});

test("linked-project Hermes patch tasks cannot succeed with an empty patch", () => {
  assert.match(source, /sourceChangesProduced = evidence\.changedFiles\.length > 0/);
  assert.match(source, /Hermes completed without producing source changes/);
  assert.match(source, /evidence\.changedFiles\.length > 0/);
});


test("paid linked-project Hermes reasoning never auto-retries", () => {
  assert.match(source, /import \{ FatalError \} from "workflow"/);
  assert.match(source, /runLinkedProjectHermes\.maxRetries = 0/);
  assert.match(source, /new FatalError/);
  assert.match(source, /do not blind-retry/i);
});

test("timeout-style linked Hermes failures include structured recovery advice", () => {
  assert.match(source, /failureAdviceFor/);
  assert.match(source, /Split this request before another paid run/);
  assert.match(source, /retrySafety: "do-not-blind-retry"/);
  assert.match(source, /costStatus: "unresolved"/);
  assert.match(source, /failureAdvice/);
});
