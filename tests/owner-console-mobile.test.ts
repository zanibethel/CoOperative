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
