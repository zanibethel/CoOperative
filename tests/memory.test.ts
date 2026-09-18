import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAgainstExisting,
  requiresOwnerConfirmation,
  selectRelevantMemories,
  type MemoryCandidate,
} from "../lib/operative/memory.ts";
import type { MemoryRecord } from "../lib/domain/operative-schemas.ts";

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    organizationId: "org-1",
    scope: "owner",
    memoryClass: "preference",
    content: "Prefers concise responses",
    sourceConversationId: null,
    sourceMessageId: null,
    sourceTaskId: null,
    extractedBy: "system",
    confidence: 0.8,
    ownerConfirmed: false,
    status: "active",
    supersedesMemoryId: null,
    pinned: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<MemoryCandidate> & Pick<MemoryCandidate, "content">): MemoryCandidate {
  return {
    organizationId: "org-1",
    scope: "owner",
    memoryClass: "preference",
    extractedBy: "system",
    ...overrides,
  };
}

test("near-identical content is flagged as a duplicate, not re-inserted", () => {
  const existing = [memory({ content: "Owner prefers concise responses" })];
  const result = checkAgainstExisting(
    candidate({ content: "owner prefers concise responses" }),
    existing,
  );
  assert.equal(result.isDuplicate, true);
  assert.equal(result.isContradiction, false);
});

test("same scope+class with materially different content is flagged as a contradiction candidate, not silently added", () => {
  const existing = [memory({ content: "Owner wants weekly cost reports" })];
  const result = checkAgainstExisting(
    candidate({ content: "Owner wants no automatic cost reports at all" }),
    existing,
  );
  assert.equal(result.isDuplicate, false);
  assert.equal(result.isContradiction, true);
  assert.equal(result.matchedMemory?.content, "Owner wants weekly cost reports");
});

test("unrelated content in the same scope+class is neither a duplicate nor a contradiction", () => {
  const existing = [memory({ content: "Owner prefers dark mode UI" })];
  const result = checkAgainstExisting(
    candidate({ content: "Owner wants Fridays kept free of scheduled tasks" }),
    existing,
  );
  assert.equal(result.isDuplicate, false);
  assert.equal(result.isContradiction, false);
  assert.equal(result.matchedMemory, null);
});

test("policy/decision contradictions always require owner confirmation", () => {
  const priorPolicy = memory({ memoryClass: "policy", ownerConfirmed: false });
  assert.equal(
    requiresOwnerConfirmation(candidate({ content: "x", memoryClass: "policy" }), priorPolicy),
    true,
  );
});

test("an owner-confirmed preference is not silently overridden by a low-confidence inference", () => {
  const priorConfirmed = memory({ ownerConfirmed: true });
  const inferredCandidate = candidate({ content: "x", extractedBy: "system" });
  assert.equal(requiresOwnerConfirmation(inferredCandidate, priorConfirmed), true);
});

test("an owner-confirmed correction can supersede a prior owner-confirmed memory without re-confirmation", () => {
  const priorConfirmed = memory({ ownerConfirmed: true });
  const newOwnerStatement = candidate({ content: "x", extractedBy: "owner-confirmed" });
  assert.equal(requiresOwnerConfirmation(newOwnerStatement, priorConfirmed), false);
});

test("selective retrieval never returns memories outside the requested scope", () => {
  const all = [
    memory({ id: "1", scope: "owner", memoryClass: "preference" }),
    memory({ id: "2", scope: "organization", memoryClass: "policy" }),
    memory({ id: "3", scope: "project", memoryClass: "goal" }),
  ];
  const result = selectRelevantMemories(all, {
    organizationId: "org-1",
    scopes: ["owner", "organization"],
  });
  assert.equal(result.length, 2);
  assert.ok(result.every((m) => m.scope === "owner" || m.scope === "organization"));
});

test("selective retrieval excludes memories from a different organization", () => {
  const all = [
    memory({ id: "1", organizationId: "org-1" }),
    memory({ id: "2", organizationId: "org-2" }),
  ];
  const result = selectRelevantMemories(all, { organizationId: "org-1", scopes: ["owner"] });
  assert.equal(result.length, 1);
  assert.equal(result[0].organizationId, "org-1");
});

test("selective retrieval excludes superseded/retired memories", () => {
  const all = [
    memory({ id: "1", status: "active" }),
    memory({ id: "2", status: "superseded" }),
    memory({ id: "3", status: "retired" }),
  ];
  const result = selectRelevantMemories(all, { organizationId: "org-1", scopes: ["owner"] });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "1");
});

test("pinned memories are ranked before higher-confidence unpinned ones", () => {
  const all = [
    memory({ id: "1", pinned: false, confidence: 0.9 }),
    memory({ id: "2", pinned: true, confidence: 0.5 }),
  ];
  const result = selectRelevantMemories(all, { organizationId: "org-1", scopes: ["owner"] });
  assert.equal(result[0].id, "2");
});

test("retrieval respects the limit to control prompt/context cost", () => {
  const all = Array.from({ length: 30 }, (_, i) =>
    memory({ id: String(i), content: `memory ${i}` }),
  );
  const result = selectRelevantMemories(all, { organizationId: "org-1", scopes: ["owner"], limit: 5 });
  assert.equal(result.length, 5);
});
