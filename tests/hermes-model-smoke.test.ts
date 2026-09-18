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

test("model smoke uses Vercel OIDC helper for AI Gateway", () => {
  assert.match(workflowSource, /getVercelOidcToken/);
  assert.match(workflowSource, /AI_GATEWAY_API_KEY:\s*oidcToken/);
  assert.equal(workflowSource.includes("process.env.VERCEL_OIDC_TOKEN"), false);
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


const registrySource = fs.readFileSync(
  path.join(process.cwd(), "lib/operative/playbook-registry.ts"),
  "utf8",
);
const executeRouteSource = fs.readFileSync(
  path.join(process.cwd(), "app/api/operative/tasks/[id]/execute/route.ts"),
  "utf8",
);

test("Cloud Hermes uses the canonical database executor contract", () => {
  assert.match(registrySource, /executor:\s*"hermes-cloud-operative"/);
  assert.equal(registrySource.includes('executor: "cloud-hermes"'), false);
  assert.match(workflowSource, /executor:\s*"hermes-cloud-operative"/);
});

test("executor selection failures become terminal task failures", () => {
  assert.match(executeRouteSource, /Executor selection failed:/);
  assert.match(executeRouteSource, /stage:\s*"executor_selection"/);
  assert.match(executeRouteSource, /status:\s*"failed"/);
});


test("Vercel OIDC helper is a pinned direct dependency", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  assert.equal(packageJson.dependencies?.["@vercel/oidc"], "3.2.0");
});

test("model smoke preserves structured Workflow errors", () => {
  assert.match(workflowSource, /record\.message/);
  assert.match(workflowSource, /record\.cause/);
});


test("Hermes shell command uses explicit separators before timeout execution", () => {
  assert.match(workflowSource, /\.join\("; "\)/);
  assert.match(workflowSource, /test -x "\$HERMES_BIN"/);
  assert.match(workflowSource, /exec timeout 75s "\$HERMES_BIN"/);
  assert.equal(workflowSource.includes('].join(" ")'), false);
});
