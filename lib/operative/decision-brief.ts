import {
  DecisionBriefSchema,
  type DecisionBrief,
  type DecisionResolution,
} from "../domain/operative-schemas.ts";

/**
 * Decision Brief builder + approve/reject/modify contract.
 *
 * Per docs/CLOUD-OPERATIVE.md "Decision Brief": any action that needs owner
 * input is normalized into this shape so the AI advisor can explain it
 * conversationally "without changing the underlying policy or approval
 * requirement." This module builds/validates briefs and resolves them; it
 * never decides on its own whether an action requires a brief in the first
 * place — that is the Task Policy Layer's job.
 */

export interface DecisionBriefInput {
  taskId?: string | null;
  conversationId?: string | null;
  proposalSummary: string;
  rationale?: string;
  expectedOutcomeIfApproved?: string;
  expectedOutcomeIfDeclined?: string;
  estimatedCostCents?: number;
  estimatedSavingsCents?: number | null;
  riskLevel?: DecisionBrief["riskLevel"];
  requiredScopes?: string[];
  rollbackPlan?: string;
  recommendedAction?: string;
}

export function buildDecisionBrief(input: DecisionBriefInput): DecisionBrief {
  return DecisionBriefSchema.parse({
    taskId: input.taskId ?? null,
    conversationId: input.conversationId ?? null,
    proposalSummary: input.proposalSummary,
    rationale: input.rationale ?? "",
    expectedOutcomeIfApproved: input.expectedOutcomeIfApproved ?? "",
    expectedOutcomeIfDeclined: input.expectedOutcomeIfDeclined ?? "",
    estimatedCostCents: input.estimatedCostCents ?? 0,
    estimatedSavingsCents: input.estimatedSavingsCents ?? null,
    riskLevel: input.riskLevel ?? "low",
    requiredScopes: input.requiredScopes ?? [],
    rollbackPlan: input.rollbackPlan ?? "",
    recommendedAction: input.recommendedAction ?? "",
  });
}

/**
 * Render a Decision Brief as plain-language conversational text for the
 * Owner Console / Telegram thread. Kept deterministic (no AI call) so the
 * brief's factual content can never drift from the underlying policy data it
 * was built from.
 */
export function renderDecisionBriefText(brief: DecisionBrief): string {
  const lines = [
    `**Proposal:** ${brief.proposalSummary}`,
    brief.rationale ? `**Why:** ${brief.rationale}` : null,
    brief.expectedOutcomeIfApproved
      ? `**If approved:** ${brief.expectedOutcomeIfApproved}`
      : null,
    brief.expectedOutcomeIfDeclined
      ? `**If declined/delayed:** ${brief.expectedOutcomeIfDeclined}`
      : null,
    `**Estimated cost:** $${(brief.estimatedCostCents / 100).toFixed(2)}`,
    brief.estimatedSavingsCents != null
      ? `**Estimated savings/impact:** $${(brief.estimatedSavingsCents / 100).toFixed(2)}`
      : null,
    `**Risk level:** ${brief.riskLevel}`,
    brief.requiredScopes.length
      ? `**Permissions/scopes required:** ${brief.requiredScopes.join(", ")}`
      : null,
    brief.rollbackPlan ? `**Rollback/stop condition:** ${brief.rollbackPlan}` : null,
    brief.recommendedAction ? `**Recommended:** ${brief.recommendedAction}` : null,
    "Reply with approve / reject / modify, or ask a question.",
  ];
  return lines.filter(Boolean).join("\n");
}

export type DecisionOutcome =
  | { status: "approved" }
  | { status: "rejected" }
  | { status: "modified"; note: string }
  | { status: "pending_clarification"; question: string };

/**
 * Resolve an owner response into a decision outcome. This performs no I/O —
 * the caller persists the resulting status/resolution to `public.decisions`
 * and advances the linked task's state machine accordingly (approved ->
 * executing, rejected/modified -> handled per task policy).
 */
export function resolveDecision(resolution: DecisionResolution): DecisionOutcome {
  switch (resolution.action) {
    case "approve":
      return { status: "approved" };
    case "reject":
      return { status: "rejected" };
    case "modify":
      return { status: "modified", note: resolution.note ?? "" };
    case "ask_question":
      return { status: "pending_clarification", question: resolution.note ?? "" };
    default: {
      const exhaustive: never = resolution.action;
      throw new Error(`Unhandled decision action: ${exhaustive}`);
    }
  }
}
