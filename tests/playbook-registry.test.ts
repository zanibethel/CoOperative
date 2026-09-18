import test from "node:test";
import assert from "node:assert/strict";

import {
  cloudPlaybookKeys,
  getCloudPlaybook,
} from "../lib/operative/playbook-registry.ts";

test("Cloud Operative exposes only reviewed playbook keys", () => {
  assert.deepEqual(cloudPlaybookKeys(), ["cloud-self-check", "hermes-runtime-check"]);
  assert.equal(getCloudPlaybook("unknown-playbook"), null);
});

test("cloud self-check uses a fixed command allow-list", () => {
  const playbook = getCloudPlaybook("cloud-self-check");
  assert.ok(playbook);
  assert.equal(playbook.requiresShell, true);
  assert.equal(playbook.repoSlug, "zanibethel/CoOperative");
  assert.deepEqual(playbook.buildCommands(), [
    { cmd: "test", args: ["-f", "package.json"] },
    { cmd: "node", args: ["--version"] },
    { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
    { cmd: "npm", args: ["test"] },
  ]);
});


test("Hermes runtime check is pinned and credential-free", () => {
  const playbook = getCloudPlaybook("hermes-runtime-check");
  assert.ok(playbook);
  assert.equal(playbook.requiresShell, true);
  const commands = playbook.buildCommands();
  assert.equal(commands.length, 3);
  const install = commands[0].args?.join(" ") ?? "";
  assert.match(install, /v2026\.9\.14/);
  assert.match(install, /--skip-setup/);
  assert.match(install, /--skip-browser/);
  assert.match(install, /--skip-computer-use/);
  assert.equal(install.includes("NOUS_API_KEY"), false);
});
