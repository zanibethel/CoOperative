import test from "node:test";
import assert from "node:assert/strict";

import {
  githubRepositoryListIntent, githubReposAssistantText,
} from "../lib/runtime/github-repository-chat.ts";

test("code-first GitHub list intent matches only explicit repo listings", () => {
  for (const value of [
    "show my GitHub repos", "list GitHub repositories",
    "which GitHub repos can you access?", "check my github repos",
  ]) {
    assert.equal(githubRepositoryListIntent(value), true, value);
  }
  for (const value of [
    "deploy my GitHub repo", "delete my GitHub repos",
    "connect GitHub", "list my email", "what's in this repository?",
    "show Vercel projects", "inspect this repo",
  ]) {
    assert.equal(githubRepositoryListIntent(value), false, value);
  }
});

test("list results are explicitly bounded and never claim write access without grant", () => {
  const response = githubReposAssistantText([
    { fullName: "first/private", private: true, canRead: true, canWrite: false },
    { fullName: "second/public", private: false, canRead: true, canWrite: true },
    { fullName: "no-content/no-content", private: true, canRead: false, canWrite: false },
  ]);
  assert.match(response, /2 repository/);
  assert.match(response, /read-only/);
  assert.match(response, /write access approved/);
  assert.doesNotMatch(response, /no-content\/no-content/);
});

test("empty or metadata-only GitHub installations guide the user to connect", () => {
  assert.match(githubReposAssistantText([]), /connect GitHub/);
  assert.match(githubReposAssistantText([
    { fullName: "org/no-access", private: false, canRead: false, canWrite: false },
  ]), /cannot see any installed/);
});
