import test from "node:test";
import assert from "node:assert/strict";

import {
  getProviderBootstrap,
  providerBootstrapsForProject,
} from "../lib/operative/provider-bootstrap.ts";
import { getLinkedProject } from "../lib/operative/project-registry.ts";

test("CreatorHub Eromify bootstrap minimizes human work and keeps secrets brokered", () => {
  const project = getLinkedProject("creatorhub");
  const bootstrap = getProviderBootstrap("creatorhub", "eromify");

  assert.ok(project);
  assert.ok(bootstrap);
  assert.deepEqual(bootstrap.preferredAuthOrder, ["oauth", "personal-api-key"]);
  assert.equal(bootstrap.currentlySupportedAuth, "personal-api-key");
  assert.deepEqual(bootstrap.secretKeys, ["EROMIFY_API_KEY"]);
  assert.equal(bootstrap.verification.capabilityPath, "/api/eromify/capabilities");

  const secret = project.secretRequirements.find(
    (item) => item.key === "EROMIFY_API_KEY",
  );
  assert.ok(secret);
  assert.equal(secret.secret, true);
  assert.equal(secret.ownerGate, true);

  const action = project.humanActions.find(
    (item) => item.key === bootstrap.humanActionKey,
  );
  assert.ok(action);
  assert.deepEqual(action.relatedSecretKeys, ["EROMIFY_API_KEY"]);

  assert.ok(
    bootstrap.automatedAfterHandoff.some((step) =>
      step.includes("discover the live Eromify MCP tool catalog"),
    ),
  );
});

test("provider bootstrap lookup is deterministic and provider-scoped", () => {
  assert.equal(getProviderBootstrap("creatorhub", "missing"), null);
  assert.equal(providerBootstrapsForProject("raisehub").length, 0);
  assert.equal(providerBootstrapsForProject("creatorhub").length, 1);
});
