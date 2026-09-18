import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getLinkedProject,
  linkedProjectKeys,
  linkedProjects,
} from "../lib/operative/project-registry.ts";

test("CreatorHub and RaiseHub are registered as linked projects", () => {
  assert.deepEqual(linkedProjectKeys(), ["creatorhub", "raisehub"]);
  assert.equal(linkedProjects().length, 2);

  const creatorhub = getLinkedProject("creatorhub");
  assert.ok(creatorhub);
  assert.equal(creatorhub.repoSlug, "zanibethel/CreatorHub");
  assert.equal(creatorhub.defaultRef, "main");
  assert.equal(creatorhub.vercelProject.name, "creatorhub");
  assert.equal(creatorhub.supabaseProjectRef, "yufptpfiwdbzzrvhkvux");
  assert.equal(creatorhub.healthPlaybookKey, "creatorhub-health-check");
  assert.equal(creatorhub.hermesPlaybookKey, "creatorhub-hermes-patch");

  const raisehub = getLinkedProject("raisehub");
  assert.ok(raisehub);
  assert.equal(raisehub.repoSlug, "zanibethel/raisehub");
  assert.equal(raisehub.vercelProject.name, "raisehub");
  assert.equal(raisehub.healthPlaybookKey, "raisehub-health-check");
  assert.equal(raisehub.hermesPlaybookKey, "raisehub-hermes-patch");
});

test("CreatorHub human setup covers Instagram, TikTok, and Fanvue without secret values", () => {
  const creatorhub = getLinkedProject("creatorhub");
  assert.ok(creatorhub);

  assert.deepEqual(
    creatorhub.humanActions.map((action) => action.provider),
    ["Vercel Connect", "Vercel", "Vercel", "Meta", "TikTok", "Fanvue"],
  );

  const serialized = JSON.stringify(creatorhub);
  assert.match(serialized, /INSTAGRAM_APP_SECRET/);
  assert.match(serialized, /TIKTOK_CLIENT_SECRET/);
  assert.match(serialized, /FANVUE_CLIENT_SECRET/);
  assert.match(serialized, /COOPERATIVE_VERCEL_ADMIN_CONNECTOR/);
  assert.equal(serialized.includes("access_token"), false);
  for (const requirement of creatorhub.secretRequirements) {
    assert.equal("value" in requirement, false);
  }
});

test("project executor preference keeps deterministic and connected ChatGPT ahead of Hermes", () => {
  for (const project of linkedProjects()) {
    assert.deepEqual(project.executorPreference, [
      "deterministic-code",
      "connected-chatgpt",
      "native-cooperative",
      "hermes-cloud-operative",
    ]);
  }
});

test("human provider browser is a non-secret handoff with popup fallback", () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), "app/console/projects/page.tsx"),
    "utf8",
  );

  assert.match(page, /CoOperative secure handoff/);
  assert.match(page, /<iframe/);
  assert.match(page, /Open external/);
  assert.match(page, /cannot read this provider page/);
  assert.match(page, /Done · return/);
  assert.match(page, /Values remain behind the secret broker gate/);
});

test("cross-repository execution uses each playbook's reviewed gitRef", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/operative/tasks/[id]/execute/route.ts"),
    "utf8",
  );

  assert.match(route, /playbook\.gitRef \?\?/);
  assert.match(route, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
});


test("linked-project UI exposes a bounded Hermes patch workspace", () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), "app/console/projects/page.tsx"),
    "utf8",
  );

  assert.match(page, /Cloud Hermes workspace/);
  assert.match(page, /Run governed Hermes patch/);
  assert.match(page, /maxSpendUsd: budget/);
  assert.match(page, /Applying that patch to GitHub remains a separate reviewed action/);
});
