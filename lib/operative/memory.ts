import type { MemoryClass, MemoryRecord, MemoryScope } from "../domain/operative-schemas.ts";

/**
 * Memory & Preference Engine — deterministic core.
 *
 * Implements the parts of docs/MEMORY-AND-PREFERENCES.md that do not require
 * AI reasoning, per the platform's playbook-first doctrine (deterministic code
 * before an AI call). Candidate extraction/classification from raw
 * conversation text is intentionally NOT implemented here — that step
 * genuinely requires interpretation and belongs behind the AI Router as a
 * narrowly scoped capability call (docs/CORE-OPERATING-MODEL.md "Small
 * execution context"). This module handles everything downstream of a
 * proposed candidate: dedup, contradiction detection, supersession, and
 * scoped retrieval.
 */

export interface MemoryCandidate {
  organizationId: string;
  scope: MemoryScope;
  memoryClass: MemoryClass;
  content: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  sourceTaskId?: string | null;
  extractedBy?: MemoryRecord["extractedBy"];
  confidence?: number;
}

export interface DedupResult {
  /** True when an existing active memory already covers this candidate. */
  isDuplicate: boolean;
  /** The existing memory this candidate duplicates or conflicts with, if any. */
  matchedMemory: MemoryRecord | null;
  /** True when the candidate conflicts with (not just duplicates) an existing memory. */
  isContradiction: boolean;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Very small deterministic heuristic: two memories in the same scope+class
 * are considered the "same slot" candidate for dedup/contradiction purposes
 * when they normalize to a high token-overlap ratio. This intentionally does
 * NOT attempt semantic understanding — that is an AI Router job. It only
 * prevents obvious duplicate inserts (identical or near-identical strings)
 * from silently piling up, and flags same-slot-but-different-content pairs as
 * candidates for AI-assisted contradiction review.
 */
function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(normalize(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalize(b).split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

const DUPLICATE_THRESHOLD = 0.92;
const SAME_SLOT_THRESHOLD = 0.4;

/**
 * Check a candidate against existing ACTIVE memories in the same
 * organization/scope/class before insert.
 *
 * Per docs/MEMORY-AND-PREFERENCES.md "Memory lifecycle": dedup, then detect
 * contradiction, then decide save-or-confirm. This function only classifies;
 * the caller decides what to do (e.g. request owner confirmation for a
 * material contradiction) and is responsible for provenance on write.
 */
export function checkAgainstExisting(
  candidate: MemoryCandidate,
  existingActiveMemories: MemoryRecord[],
): DedupResult {
  const sameSlot = existingActiveMemories.filter(
    (m) => m.scope === candidate.scope && m.memoryClass === candidate.memoryClass,
  );

  let best: { memory: MemoryRecord; ratio: number } | null = null;
  for (const memory of sameSlot) {
    const ratio = tokenOverlapRatio(memory.content, candidate.content);
    if (!best || ratio > best.ratio) {
      best = { memory, ratio };
    }
  }

  if (!best) {
    return { isDuplicate: false, matchedMemory: null, isContradiction: false };
  }

  if (best.ratio >= DUPLICATE_THRESHOLD) {
    return { isDuplicate: true, matchedMemory: best.memory, isContradiction: false };
  }

  if (best.ratio >= SAME_SLOT_THRESHOLD) {
    // Same scope+class, overlapping-but-different content: likely a change of
    // mind / updated preference rather than an unrelated new memory.
    return { isDuplicate: false, matchedMemory: best.memory, isContradiction: true };
  }

  return { isDuplicate: false, matchedMemory: null, isContradiction: false };
}

/**
 * Per docs/MEMORY-AND-PREFERENCES.md "Contradictions and changing
 * preferences": prefer the newest explicit owner statement, preserve the
 * prior value as superseded (never silently overwrite), and flag material
 * contradictions for owner confirmation rather than auto-resolving them.
 *
 * "Material" is intentionally conservative here: policy/decision memories
 * always require confirmation on contradiction; preference/goal/fact only
 * require confirmation when the new candidate was not itself owner-confirmed
 * (i.e. a low-confidence inference should not silently override a
 * high-confidence, previously owner-confirmed memory).
 */
export function requiresOwnerConfirmation(
  candidate: MemoryCandidate,
  matched: MemoryRecord,
): boolean {
  const highStakesClass = matched.memoryClass === "policy" || matched.memoryClass === "decision";
  if (highStakesClass) return true;
  return matched.ownerConfirmed && candidate.extractedBy !== "owner-confirmed";
}

/**
 * Build the supersession patch for the prior memory record. The caller
 * applies this as an update (status -> 'superseded') before inserting the
 * new record with `supersedesMemoryId` pointing at the old id. Never deletes
 * history, per docs/MEMORY-AND-PREFERENCES.md "retain provenance/history".
 */
export function buildSupersessionPatch(): Pick<MemoryRecord, "status"> {
  return { status: "superseded" };
}

/**
 * Selective retrieval: only pull memories relevant to the current context,
 * never the entire store, per docs/MEMORY-AND-PREFERENCES.md "Retrieval" and
 * docs/OMNICHANNEL-CONVERSATIONS.md "Cost control".
 */
export interface MemoryRetrievalFilter {
  organizationId: string;
  scopes: MemoryScope[];
  classes?: MemoryClass[];
  /** Cap the number of memories injected into a prompt/context. */
  limit?: number;
}

export function selectRelevantMemories(
  all: MemoryRecord[],
  filter: MemoryRetrievalFilter,
): MemoryRecord[] {
  const limit = filter.limit ?? 20;
  return all
    .filter((m) => m.organizationId === filter.organizationId)
    .filter((m) => m.status === "active")
    .filter((m) => filter.scopes.includes(m.scope))
    .filter((m) => (filter.classes ? filter.classes.includes(m.memoryClass) : true))
    .sort((a, b) => {
      // Pinned first, then higher confidence, then more recently confirmed.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.confidence - a.confidence;
    })
    .slice(0, limit);
}
