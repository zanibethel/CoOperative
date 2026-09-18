import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const adapterPath = path.join(process.cwd(), "lib/operative/hermes-cloud-adapter.ts");
const source = fs.readFileSync(adapterPath, "utf8");

test("Cloud Hermes adapter pins the reviewed Hermes release", () => {
  assert.match(source, /v2026\.9\.14/);
  assert.match(source, /--skip-setup/);
  assert.match(source, /--skip-browser/);
  assert.match(source, /--skip-computer-use/);
});

test("Cloud Hermes adapter keeps owner prompt out of shell arguments", () => {
  assert.match(source, /writeFiles/);
  assert.match(source, /\/tmp\/cooperative-task\.md/);
  assert.match(source, /--query-file/);
  assert.equal(source.includes("spec.prompt, \"--"), false);
});

test("Cloud Hermes adapter passes only the provider credential into Sandbox env", () => {
  const envBlock = source.match(/env:\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(envBlock);
  assert.match(envBlock[1], /NOUS_API_KEY/);
  assert.equal(envBlock[1].includes("SUPABASE_SECRET_KEY"), false);
});

test("Cloud Hermes adapter bounds turns/runtime and captures usage", () => {
  assert.match(source, /--max-turns/);
  assert.match(source, /--run-budget/);
  assert.match(source, /--usage-file/);
  assert.match(source, /hermes-usage\.json/);
});
