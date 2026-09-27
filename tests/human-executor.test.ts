import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATORHUB_MOBILE_VERIFICATION,
  effectiveHourlyRateCents,
  workOrderMatchesProfile,
  type WorkerProfile,
} from "../lib/human-executor/contracts.ts";

const worker: WorkerProfile = {
  displayName: "Test Worker",
  skills: ["Mobile testing"],
  devices: ["iPhone"],
  locationMode: "remote",
  minimumHourlyRateCents: 2500,
  preferredTaskMinutes: 30,
  blockedCategories: [],
  notificationsEnabled: true,
};

test("sample CreatorHub work is clearly test-only and phone guided", () => {
  assert.equal(CREATORHUB_MOBILE_VERIFICATION.testOnly, true);
  assert.equal(CREATORHUB_MOBILE_VERIFICATION.compensationCents, 800);
  assert.equal(CREATORHUB_MOBILE_VERIFICATION.estimatedMinutes, 10);
  assert.equal(CREATORHUB_MOBILE_VERIFICATION.steps.length, 5);
  assert.deepEqual(CREATORHUB_MOBILE_VERIFICATION.requiredDevices, ["iPhone"]);
  assert.ok(CREATORHUB_MOBILE_VERIFICATION.steps.every((step) => step.helpText.length > 0));
});

test("effective hourly rate reflects compensation and estimated human time", () => {
  assert.equal(effectiveHourlyRateCents(800, 10), 4800);
  assert.equal(effectiveHourlyRateCents(1200, 30), 2400);
});

test("matching honors worker minimum compensation and device requirements", () => {
  assert.equal(workOrderMatchesProfile(worker, CREATORHUB_MOBILE_VERIFICATION), true);

  assert.equal(
    workOrderMatchesProfile(
      { ...worker, minimumHourlyRateCents: 5000 },
      CREATORHUB_MOBILE_VERIFICATION,
    ),
    false,
  );

  assert.equal(
    workOrderMatchesProfile(
      { ...worker, devices: ["Computer"] },
      CREATORHUB_MOBILE_VERIFICATION,
    ),
    false,
  );
});
