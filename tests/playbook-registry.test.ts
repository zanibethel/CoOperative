import test from "node:test";
import assert from "node:assert/strict";

import {
  cloudPlaybookKeys,
  getCloudPlaybook,
} from "../lib/operative/playbook-registry.ts";

test("Cloud Operative exposes only reviewed playbook keys", () => {
  assert.deepEqual(cloudPlaybookKeys(), [
    "cloud-self-check",
    "hermes-runtime-check",
    "hermes-model-smoke",
    "creatorhub-health-check",
    "raisehub-health-check",
    "creatorhub-hermes-patch",
    "raisehub-hermes-patch",
  ]);
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


test("model-backed Hermes smoke uses the governed hermes-cloud-operative executor", () => {
  const playbook = getCloudPlaybook("hermes-model-smoke");
  assert.ok(playbook);
  assert.equal(playbook.executor, "hermes-cloud-operative");
  assert.equal(playbook.executionMode, "workflow");
  assert.deepEqual(playbook.buildCommands(), []);
});


test("linked-project playbooks pin their own repositories and refs", () => {
  const creatorhub = getCloudPlaybook("creatorhub-health-check");
  const raisehub = getCloudPlaybook("raisehub-health-check");

  assert.ok(creatorhub);
  assert.equal(creatorhub.repoSlug, "zanibethel/CreatorHub");
  assert.equal(creatorhub.gitRef, "main");
  assert.equal(creatorhub.executor, "deterministic-code");
  assert.equal(creatorhub.executionMode, "detached");
  assert.match(JSON.stringify(creatorhub.buildCommands()), /tsc/);
  assert.match(JSON.stringify(creatorhub.buildCommands()), /lint/);
  assert.match(JSON.stringify(creatorhub.buildCommands()), /build/);

  assert.ok(raisehub);
  assert.equal(raisehub.repoSlug, "zanibethel/raisehub");
  assert.equal(raisehub.gitRef, "main");
  assert.equal(raisehub.executor, "deterministic-code");
  assert.equal(raisehub.executionMode, "detached");
  assert.match(JSON.stringify(raisehub.buildCommands()), /npm/);
  assert.match(JSON.stringify(raisehub.buildCommands()), /test/);
});


test("linked-project Hermes playbooks are workflow-backed and project-scoped", () => {
  const creatorhub = getCloudPlaybook("creatorhub-hermes-patch");
  const raisehub = getCloudPlaybook("raisehub-hermes-patch");

  assert.ok(creatorhub);
  assert.equal(creatorhub.executor, "hermes-cloud-operative");
  assert.equal(creatorhub.executionMode, "workflow");
  assert.equal(creatorhub.projectKey, "creatorhub");
  assert.equal(creatorhub.repoSlug, "zanibethel/CreatorHub");
  assert.equal(creatorhub.gitRef, "main");
  assert.match(JSON.stringify(creatorhub.buildCommands()), /tsc/);

  assert.ok(raisehub);
  assert.equal(raisehub.executor, "hermes-cloud-operative");
  assert.equal(raisehub.executionMode, "workflow");
  assert.equal(raisehub.projectKey, "raisehub");
  assert.equal(raisehub.repoSlug, "zanibethel/raisehub");
  assert.equal(raisehub.gitRef, "main");
  assert.match(JSON.stringify(raisehub.buildCommands()), /test/);
});
