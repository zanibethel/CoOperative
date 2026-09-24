import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const menu = fs.readFileSync(
  path.join(process.cwd(), "app/SiteMenu.tsx"),
  "utf8",
);
const layout = fs.readFileSync(
  path.join(process.cwd(), "app/layout.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(process.cwd(), "app/site-menu.css"),
  "utf8",
);

test("global hamburger menu exposes every core CoOperative destination", () => {
  assert.match(menu, /href: "\/"/);
  assert.match(menu, /href: "\/console"/);
  assert.match(menu, /href: "\/console\/projects"/);
  assert.match(menu, /href: "\/services"/);
  assert.match(menu, /href: "\/intake"/);
  assert.match(menu, /Provider setup lives in Linked Projects/);
});

test("root layout mounts the menu on every page", () => {
  assert.match(layout, /import SiteMenu from "\.\/SiteMenu"/);
  assert.match(layout, /<SiteMenu \/>/);
  assert.match(layout, /import "\.\/site-menu\.css"/);
});

test("hamburger menu is mobile-safe and dismissible", () => {
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /setOpen\(false\)/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-top\)/);
});
