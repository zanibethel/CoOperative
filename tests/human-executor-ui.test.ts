import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(path.join(process.cwd(), "app/work/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(process.cwd(), "app/work/work.module.css"), "utf8");
const schema = fs.readFileSync(
  path.join(process.cwd(), "database/schema-v0.3-human-executor.sql"),
  "utf8",
);

test("worker preview exposes profile, offer, guided steps, help, and test earnings", () => {
  assert.match(page, /Save work preferences/);
  assert.match(page, /Accept .* task/);
  assert.match(page, /Need help\?/);
  assert.match(page, /Step \{stepIndex \+ 1\} of/);
  assert.match(page, /Submit work/);
  assert.match(page, /Test earnings/);
  assert.match(page, /localStorage/);
});

test("worker flow is designed phone-first", () => {
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test("review-only schema keeps assignments and earnings server mediated", () => {
  assert.match(schema, /REVIEW ONLY/);
  assert.match(schema, /create table if not exists public\.worker_profiles/);
  assert.match(schema, /create table if not exists public\.human_work_orders/);
  assert.match(schema, /create table if not exists public\.human_assignments/);
  assert.match(schema, /create table if not exists public\.worker_earnings/);
  assert.doesNotMatch(schema, /grant insert.*human_assignments to authenticated/i);
  assert.doesNotMatch(schema, /grant insert.*worker_earnings to authenticated/i);
});
