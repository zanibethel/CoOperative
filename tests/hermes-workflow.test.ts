import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workflowPath = path.join(process.cwd(), "lib/workflow/hermes-runtime.ts");
const workflowSource = fs.readFileSync(workflowPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
const proxySource = fs.readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");

test("Workflow runtime is pinned and Next.js integration is enabled", () => {
  assert.equal(packageJson.dependencies?.workflow, "4.8.9");
  assert.match(nextConfig, /withWorkflow/);
  assert.match(proxySource, /\.well-known\/workflow\//);
});

test("Cloud Hermes runtime workflow is durable and step-based", () => {
  assert.match(workflowSource, /"use workflow"/);
  assert.match(workflowSource, /"use step"/);
  assert.match(workflowSource, /Sandbox\.getOrCreate/);
  assert.match(workflowSource, /Sandbox\.fork/);
});

test("prepared Hermes runtime is versioned and provider-credential free", () => {
  assert.match(workflowSource, /cooperative-hermes-runtime-v2026-9-14/);
  assert.match(workflowSource, /v2026\.9\.14/);
  assert.equal(workflowSource.includes("NOUS_API_KEY"), false);
  assert.equal(workflowSource.includes("SUPABASE_SECRET_KEY"), false);
});

test("workflow records durable progress stages", () => {
  for (const stage of [
    "preparing_runtime",
    "starting_hermes",
    "executing_check",
    "verifying",
    "completed",
    "failed",
  ]) {
    assert.match(workflowSource, new RegExp(stage));
  }
});
