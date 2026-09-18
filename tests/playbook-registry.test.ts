import test from "node:test";
import assert from "node:assert/strict";

import {
  cloudPlaybookKeys,
  getCloudPlaybook,
} from "../lib/operative/playbook-registry.ts";

test("Cloud Operative exposes only reviewed playbook keys", () => {
  assert.deepEqual(cloudPlaybookKeys(), ["cloud-self-check"]);
  assert.equal(getCloudPlaybook("unknown-playbook"), null);
});

test("cloud self-check uses a fixed command allow-list", () => {
  const playbook = getCloudPlaybook("cloud-self-check");
  assert.ok(playbook);
  assert.equal(playbook.requiresShell, true);
  assert.equal(playbook.repoSlug, "zanibethel/CoOperative");
  assert.deepEqual(playbook.buildCommands(), [
    { cmd: "git", args: ["rev-parse", "HEAD"] },
    { cmd: "node", args: ["--version"] },
    { cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
    { cmd: "npm", args: ["test"] },
  ]);
});
