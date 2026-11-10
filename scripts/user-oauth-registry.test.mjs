import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_CONNECTOR_REGISTRY,
  serviceConnectorForText,
  serviceConnectorByKey,
} from "../lib/runtime/service-connector-registry.ts";

test("developer and personal providers route through individual OAuth connectors", () => {
  for (const [utterance, expected] of [
    ["connect my GitHub repo", "github"],
    ["link my Gmail account", "gmail"],
    ["connect my Roblox account", "roblox"],
  ]) {
    const matched = serviceConnectorForText(utterance);
    assert.equal(matched?.providerKey, expected, utterance);
    assert.equal(matched?.authKind, "oauth", utterance);
    assert.equal(matched?.implementation, "available", utterance);
    assert.match(matched?.endpoint || "", /providerKey=/);
  }
});

test("unimplemented platform services never imply they are already linked", () => {
  for (const key of ["vercel", "supabase", "facebook", "instagram", "icloud"]) {
    const connector = serviceConnectorByKey(key);
    assert.ok(connector);
    assert.equal(connector.implementation, "build-required");
    assert.equal(connector.endpoint, undefined);
  }
});

test("all connector keys and their declared endpoints are unique", () => {
  const keys = SERVICE_CONNECTOR_REGISTRY.map((c) => c.providerKey);
  assert.equal(new Set(keys).size, keys.length);
  const endpoints = SERVICE_CONNECTOR_REGISTRY.filter((c) => c.endpoint)
    .map((c) => c.endpoint);
  assert.equal(new Set(endpoints).size, endpoints.length);
});

test("passwords and secrets are never part of public connector metadata", () => {
  for (const connector of SERVICE_CONNECTOR_REGISTRY) {
    assert.deepEqual(
      Object.keys(connector).filter((key) => /token|secret|password|credentialvalue/i.test(key)),
      [],
    );
  }
});
