import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidTaskTransition,
  TASK_STATUS_TRANSITIONS,
  type TaskStatus,
} from "../lib/domain/operative-schemas.ts";

test("queued can move to planning or cancelled only", () => {
  assert.equal(isValidTaskTransition("queued", "planning"), true);
  assert.equal(isValidTaskTransition("queued", "cancelled"), true);
  assert.equal(isValidTaskTransition("queued", "executing"), false);
  assert.equal(isValidTaskTransition("queued", "completed"), false);
});

test("a status can never transition to itself", () => {
  for (const status of Object.keys(TASK_STATUS_TRANSITIONS) as TaskStatus[]) {
    assert.equal(isValidTaskTransition(status, status), false);
  }
});

test("terminal states have no outgoing transitions", () => {
  for (const terminal of ["completed", "rolled_back", "cancelled"] as TaskStatus[]) {
    assert.deepEqual(TASK_STATUS_TRANSITIONS[terminal], []);
  }
});

test("awaiting_approval can resolve to executing (approved), cancelled (rejected), or blocked", () => {
  assert.equal(isValidTaskTransition("awaiting_approval", "executing"), true);
  assert.equal(isValidTaskTransition("awaiting_approval", "cancelled"), true);
  assert.equal(isValidTaskTransition("awaiting_approval", "blocked"), true);
  assert.equal(isValidTaskTransition("awaiting_approval", "completed"), false);
});

test("executing can fall back to awaiting_approval mid-task (new risk discovered)", () => {
  assert.equal(isValidTaskTransition("executing", "awaiting_approval"), true);
});

test("failed can retry via queued or terminate via rolled_back", () => {
  assert.equal(isValidTaskTransition("failed", "queued"), true);
  assert.equal(isValidTaskTransition("failed", "rolled_back"), true);
  assert.equal(isValidTaskTransition("failed", "executing"), false);
});
