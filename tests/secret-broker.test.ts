import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getLinkedProject } from "../lib/operative/project-registry.ts";

const broker = fs.readFileSync(
  path.join(process.cwd(), "lib/operative/vercel-secret-broker.ts"),
  "utf8",
);
const requestRoute = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/operative/projects/[projectKey]/secrets/route.ts",
  ),
  "utf8",
);
const applyRoute = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/operative/projects/[projectKey]/secrets/apply/route.ts",
  ),
  "utf8",
);
const panel = fs.readFileSync(
  path.join(process.cwd(), "app/console/projects/SecretBrokerPanel.tsx"),
  "utf8",
);

test("CreatorHub secret broker allow-list contains names and policy, never values", () => {
  const project = getLinkedProject("creatorhub");
  assert.ok(project);
  assert.ok(project.secretRequirements.length >= 8);
  for (const requirement of project.secretRequirements) {
    assert.match(requirement.key, /^[A-Za-z0-9_]+$/);
    assert.equal(requirement.ownerGate, true);
    assert.ok(requirement.environments.length > 0);
    assert.equal("value" in requirement, false);
  }
});

test("secret broker has a reviewed default connector UID", () => {
  assert.match(
    broker,
    /DEFAULT_VERCEL_ADMIN_CONNECTOR\s*=\s*\n?\s*"cooperative-vercel-admin\/secret-broker"/,
  );
  assert.match(broker, /configuredConnectorUid/);
});

test("secret broker obtains its Vercel API credential through Connect + OIDC", () => {
  assert.match(broker, /COOPERATIVE_VERCEL_ADMIN_CONNECTOR/);
  assert.match(broker, /getVercelOidcToken/);
  assert.match(broker, /https:\/\/api\.vercel\.com\/v1\/connect\/token\//);
  assert.match(broker, /subject: \{ type: "app" \}/);
  assert.equal(broker.includes("VERCEL_TOKEN"), false);
});

test("secret broker preflights linked-project access before sending a secret value", () => {
  assert.match(broker, /resolveAccessibleVercelProject/);
  assert.match(broker, /https:\/\/api\.vercel\.com\/v9\/projects\//);
  assert.match(broker, /project\.vercelProject\.id/);
  assert.match(broker, /project\.vercelProject\.name/);
  assert.match(broker, /stored Vercel access token is likely scoped too narrowly/);
  assert.match(broker, /No secret value was sent to Vercel/);
});

test("secret broker only writes allow-listed sensitive Vercel environment variables", () => {
  assert.match(broker, /getAllowedSecretRequirement/);
  assert.match(broker, /https:\/\/api\.vercel\.com\/v10\/projects\//);
  assert.match(broker, /url\.searchParams\.set\("upsert", "true"\)/);
  assert.match(broker, /type: "sensitive"/);
  assert.match(broker, /target: \[input\.target\]/);
  assert.match(broker, /value: input\.value/);
  assert.match(broker, /No secret value was retained by CoOperative/);
});

test("secret request creates approval before value entry exists", () => {
  assert.match(requestRoute, /requires_owner_approval: true/);
  assert.match(requestRoute, /risk_level: "high"/);
  assert.match(requestRoute, /"secret-access"/);
  assert.match(requestRoute, /"production-change"/);
  assert.match(requestRoute, /valueCaptured: false/);
  assert.match(requestRoute, /status: "pending"/);
  assert.equal(requestRoute.includes("parsed.data.value"), false);
});

test("secret application requires approved decision and exact scope match", () => {
  assert.match(applyRoute, /\.eq\("status", "approved"\)/);
  assert.match(applyRoute, /OWNER_APPROVAL_REQUIRED/);
  assert.match(applyRoute, /SECRET_APPROVAL_SCOPE_MISMATCH/);
  assert.match(applyRoute, /getAllowedSecretRequirement/);
  assert.match(applyRoute, /valueSharedWithHermes: false/);
  assert.match(applyRoute, /deploymentPerformed: false/);
  assert.match(applyRoute, /status: "verifying"/);
  assert.match(applyRoute, /status: "completed"/);
});

test("secret UI keeps value entry locked until approval and uses password input", () => {
  assert.match(panel, /approvalStatus === "approved"/);
  assert.match(panel, /type="password"/);
  assert.match(panel, /autoComplete="off"/);
  assert.match(panel, /Apply securely/);
  assert.match(panel, /No secret value has been requested yet/);
  assert.match(panel, /did not redeploy the project/);
});
