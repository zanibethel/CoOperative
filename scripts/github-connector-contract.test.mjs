import test from "node:test";
import assert from "node:assert/strict";

import {
  githubRepoSlug,
  githubFilePath,
  githubRepoApiPath,
} from "../lib/integrations/github-connector-contract.ts";

test("valid repository names must be owner/name without injected URLs or traversal", () => {
  assert.deepEqual(githubRepoSlug("zanibethel/CoOperative"), {
    owner: "zanibethel",
    repo: "CoOperative",
  });
  assert.equal(githubRepoApiPath("zanibethel/CoOperative"),
    "/repos/zanibethel/CoOperative");
  for (const value of [
    "", "foo", "foo/bar/baz", "https://evil.example/github", "//evil/repo",
    "../repo", "org/../repo", "org/.git/", "org/..", ".hidden/repo", "org/repo?token=X",
    "org/repo#fragment", "org/%2f", "org/with space", "org/repo\\\\dir",
  ]) {
    assert.throws(() => githubRepoSlug(value), value);
  }
});

test("repository file paths are segmented, encoded, and must never traverse", () => {
  assert.equal(githubFilePath("src/app/page.tsx"), "src/app/page.tsx");
  assert.equal(githubFilePath("read me.md"), "read%20me.md");
  for (const value of [
    "", "/README.md", "src/", "src//file.ts", "./package.json",
    "src/../.env", "src/./file.ts", "a\\\\b", "a\\nsecret", "../private",
  ]) {
    assert.throws(() => githubFilePath(value), value);
  }
});

test("GitHub tools never accept unsafe generic URLs as repository selectors", () => {
  for (const value of [
    "https://api.github.com/user", "http://169.254.169.254/latest/meta-data",
    "user:token@evil.example/repo", "my-repo?per_page=100&other=1",
  ]) {
    assert.throws(() => githubRepoApiPath(value), value);
  }
});
