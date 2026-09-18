import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDecisionBrief, renderDecisionBriefText, resolveDecision } from "../lib/operative/decision-brief.ts";

test("buildDecisionBrief fills defaults for optional fields", () => {
  const brief = buildDecisionBrief({ proposalSummary: "Enable Square OAuth" });
  assert.equal(brief.proposalSummary, "Enable Square OAuth");
  assert.equal(brief.riskLevel, "low");
  assert.equal(brief.estimatedCostCents, 0);
  assert.deepEqual(brief.requiredScopes, []);
});

test("renderDecisionBriefText includes every populated field and the action prompt", () => {
  const brief = buildDecisionBrief({
    proposalSummary: "Provision a Vercel Sandbox for the Square connector build",
    rationale: "Needed to run tests in isolation",
    estimatedCostCents: 34,
    riskLevel: "medium",
    requiredScopes: ["sandbox:create"],
    rollbackPlan: "Stop the sandbox; no persistent state created",
    recommendedAction: "Approve",
  });
  const text = renderDecisionBriefText(brief);
  assert.match(text, /Provision a Vercel Sandbox/);
  assert.match(text, /\$0\.34/);
  assert.match(text, /medium/);
  assert.match(text, /sandbox:create/);
  assert.match(text, /approve \/ reject \/ modify/i);
});

test("renderDecisionBriefText omits empty optional fields instead of printing blanks", () => {
  const brief = buildDecisionBrief({ proposalSummary: "Minimal proposal" });
  const text = renderDecisionBriefText(brief);
  assert.doesNotMatch(text, /\*\*Why:\*\*/);
  assert.doesNotMatch(text, /\*\*Rollback/);
});

test("resolveDecision maps approve/reject/modify/ask_question to the correct outcome", () => {
  const base = { decisionId: "d1", resolvedBy: "u1", resolvedViaChannel: "owner-console" as const };
  assert.deepEqual(resolveDecision({ ...base, action: "approve" }), { status: "approved" });
  assert.deepEqual(resolveDecision({ ...base, action: "reject" }), { status: "rejected" });
  assert.deepEqual(resolveDecision({ ...base, action: "modify", note: "use option B" }), {
    status: "modified",
    note: "use option B",
  });
  assert.deepEqual(resolveDecision({ ...base, action: "ask_question", note: "what is the cost?" }), {
    status: "pending_clarification",
    question: "what is the cost?",
  });
});
