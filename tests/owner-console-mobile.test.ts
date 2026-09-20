import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(
  path.join(process.cwd(), "app/console/page.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf8",
);

test("Mission Control errors are collapsed and copyable instead of expanding cards", () => {
  assert.match(page, /<details className="task-error">/);
  assert.match(page, /Copy error/);
  assert.match(page, /task-error-code/);
  assert.equal(page.includes('<p className="error">{task.error}</p>'), false);

  assert.match(css, /\.task-error-code\s*\{/);
  assert.match(css, /max-height:\s*180px/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("Mission Control can prepare governed explain and fix requests from an error", () => {
  assert.match(page, /Ask CoOperative to explain/);
  assert.match(page, /Ask CoOperative to fix/);
  assert.match(page, /Review the Integration Compatibility Registry/);
  assert.match(page, /Fix request prepared in the composer/);
});

test("mobile task descriptions and cards cannot force horizontal page expansion", () => {
  assert.match(page, /className="task-description"/);
  assert.match(css, /\.task-card, \.decision-card[\s\S]*?min-width:\s*0[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.task-description[\s\S]*?overflow-wrap:\s*anywhere/);
});

test("sub-cent costs display full microunit precision and legacy unknown cost is not shown as free", () => {
  assert.match(page, /fractionDigits = absolute < 10_000 \? 6/);
  assert.match(page, /cost unresolved/);
  assert.match(page, /usageCostStatus === "unknown"/);
});


test("Mission Control exposes linked-project Hermes patch evidence without auto-applying it", () => {
  assert.match(page, /View linked-project patch/);
  assert.match(page, /Copy patch/);
  assert.match(page, /repository write not performed/);
  assert.match(page, /taskHermesProjectPatch/);
});


test("Mission Control task cards show execution start and terminal end timestamps", () => {
  assert.match(page, /className="task-timing"/);
  assert.match(page, /<b>Started<\/b>/);
  assert.match(page, /task\.started_at \?\? task\.created_at/);
  assert.match(page, /task\.ended_at \? formatTime\(task\.ended_at\) : "In progress"/);
});


test("failed tasks surface recommended recovery instead of only a failed message", () => {
  assert.match(page, /Recommended next step/);
  assert.match(page, /Prepare recommended recovery/);
  assert.match(page, /taskFailureAdvice/);
  assert.match(page, /do not blind-retry/);
  assert.match(page, /Cost status: unresolved/);
});

test("blind Hermes retry is hidden when recovery advice says not to retry", () => {
  assert.match(page, /retrySafety !== "do-not-blind-retry"/);
});


test("recommended recovery visibly prepares a zero-spend draft and opens the real composer", () => {
  assert.match(page, /id="owner-composer"/);
  assert.match(page, /id="owner-composer-textarea"/);
  assert.match(page, /setMaxSpendUsd\("0"\)/);
  assert.match(page, /setRecoveryPreparedTaskId\(task\.id\)/);
  assert.match(page, /Recovery draft prepared/);
  assert.match(page, /Open recovery draft/);
  assert.match(page, /jumpToComposer/);
});


test("recovery draft opens inline and remains zero-spend until separately queued", () => {
  assert.match(page, /setRecoveryOpenTaskId\(task\.id\)/);
  assert.match(page, /aria-label="Prepared recovery draft"/);
  assert.match(page, /Copy draft/);
  assert.match(page, /Edit in Owner composer/);
  assert.match(page, /Nothing has run\. Queueing or executing a new task remains a separate action/);
});


test("recommended recovery can execute directly from the failed task card", () => {
  assert.match(page, /executeRecommendedRecovery/);
  assert.match(page, /Execute recommended recovery · max \$/);
  assert.match(page, /recommendedRecoveryBudgetUsd/);
  assert.match(page, /playbookKey: projectKey \+ "-hermes-patch"/);
  assert.match(page, /Authorized model spend cap:/);
  assert.match(page, /saved to the canonical conversation/);
});


test("direct recovery execution uses a separate bounded executable prompt", () => {
  assert.match(page, /executablePrompt\?: string/);
  assert.match(page, /const executablePrompt = advice\?\.executablePrompt/);
  assert.match(page, /description: executablePrompt/);
  assert.match(page, /taskFailureAdvice\(task\.result\)\?\.executablePrompt/);
  assert.match(page, /needs review before it can be executed directly/);
});


test("verification failures can launch an owner-gated targeted repair from the preserved patch", () => {
  assert.match(page, /repairSourceTaskId\?: string/);
  assert.match(page, /Execute targeted repair · max \$/);
  assert.match(page, /repairSourceTaskId: advice\.repairSourceTaskId \?\? null/);
  assert.match(page, /targeted repair started · max \$/);
  assert.match(page, /saved to the canonical conversation/);
});
