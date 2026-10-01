import type {
  TextInferenceMessage,
} from "@/lib/inference/contracts";
import type {
  LocalTextProfile,
  TextTaskClass,
} from "@/lib/inference/text-model-registry";

export type EscalationVerificationStatus =
  | "not_run"
  | "passed"
  | "failed"
  | "inconclusive";

export type PaidExecutorCandidate = {
  id: string;
  provider: string;
  model: string;
  available: boolean;
  qualified: boolean;
  businessOwned?: boolean;
  supportedTaskClasses?: TextTaskClass[];
  maxInputCharacters?: number;
  benchmarkSuccessRate?: number;
  estimatedMarginalCostUsd?: number;
};

export type EscalationEvidence = {
  taskClass: TextTaskClass;
  localProfile: LocalTextProfile;
  messages: TextInferenceMessage[];
  requestedOutputTokens: number;
  localAttempts: number;
  localFailures: number;
  malformedStructuredOutputs?: number;
  scopeGuardRejections?: number;
  verificationStatus: EscalationVerificationStatus;
  allowPaidFallback: boolean;
  automaticPaidBudgetUsd?: number;
  requiredSuccessRate?: number;
};

export type EscalationDecision =
  | {
      action: "stay-local";
      justified: false;
      reason: string;
      reasonCodes: string[];
      score: number;
      candidate: null;
    }
  | {
      action: "no-qualified-executor";
      justified: true;
      reason: string;
      reasonCodes: string[];
      score: number;
      candidate: null;
    }
  | {
      action: "approval-required";
      justified: true;
      reason: string;
      reasonCodes: string[];
      score: number;
      candidate: PaidExecutorCandidate;
    }
  | {
      action: "escalate";
      justified: true;
      reason: string;
      reasonCodes: string[];
      score: number;
      candidate: PaidExecutorCandidate;
    };

const HARD_TASKS = new Set<TextTaskClass>([
  "coding",
  "debugging",
  "reasoning",
  "long-context",
]);

function inputCharacters(messages: TextInferenceMessage[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function escalationScore(evidence: EscalationEvidence) {
  let score = 0;
  const reasonCodes: string[] = [];

  if (evidence.verificationStatus === "failed") {
    score += 4;
    reasonCodes.push("verification-failed");
  } else if (evidence.verificationStatus === "inconclusive") {
    score += 2;
    reasonCodes.push("verification-inconclusive");
  }

  if (evidence.localFailures > 0) {
    score += bounded(evidence.localFailures, 0, 3);
    reasonCodes.push("local-failure");
  }

  if (evidence.localAttempts >= 2) {
    score += 2;
    reasonCodes.push("repeated-local-attempt");
  }

  if ((evidence.malformedStructuredOutputs || 0) >= 2) {
    score += 3;
    reasonCodes.push("repeated-structured-output-failure");
  } else if ((evidence.malformedStructuredOutputs || 0) === 1) {
    score += 1;
    reasonCodes.push("structured-output-failure");
  }

  if ((evidence.scopeGuardRejections || 0) > 0) {
    score += Math.min(3, (evidence.scopeGuardRejections || 0) * 2);
    reasonCodes.push("scope-guard-rejection");
  }

  if (HARD_TASKS.has(evidence.taskClass)) {
    score += 1;
    reasonCodes.push("hard-task-class");
  }

  if (inputCharacters(evidence.messages) > 12_000) {
    score += 1;
    reasonCodes.push("large-context");
  }

  if (evidence.requestedOutputTokens > 1600) {
    score += 1;
    reasonCodes.push("large-output");
  }

  return { score, reasonCodes };
}

function qualifies(
  candidate: PaidExecutorCandidate,
  evidence: EscalationEvidence,
) {
  if (!candidate.available || !candidate.qualified) return false;
  if (
    candidate.supportedTaskClasses?.length &&
    !candidate.supportedTaskClasses.includes(evidence.taskClass)
  ) {
    return false;
  }
  if (
    typeof candidate.maxInputCharacters === "number" &&
    inputCharacters(evidence.messages) > candidate.maxInputCharacters
  ) {
    return false;
  }

  const requiredSuccessRate = evidence.requiredSuccessRate ?? 0.8;
  if (
    typeof candidate.benchmarkSuccessRate === "number" &&
    candidate.benchmarkSuccessRate < requiredSuccessRate
  ) {
    return false;
  }

  return true;
}

function candidateRank(candidate: PaidExecutorCandidate) {
  const ownedBoost = candidate.businessOwned ? 1 : 0;
  const success = candidate.benchmarkSuccessRate ?? 0;
  const cost =
    typeof candidate.estimatedMarginalCostUsd === "number"
      ? candidate.estimatedMarginalCostUsd
      : Number.POSITIVE_INFINITY;

  return { ownedBoost, success, cost };
}

function chooseCandidate(
  candidates: PaidExecutorCandidate[],
  evidence: EscalationEvidence,
) {
  return [...candidates]
    .filter((candidate) => qualifies(candidate, evidence))
    .sort((a, b) => {
      const left = candidateRank(a);
      const right = candidateRank(b);

      if (left.ownedBoost !== right.ownedBoost) {
        return right.ownedBoost - left.ownedBoost;
      }
      if (left.success !== right.success) {
        return right.success - left.success;
      }
      return left.cost - right.cost;
    })[0] ?? null;
}

export function evaluatePaidEscalation(
  evidence: EscalationEvidence,
  candidates: PaidExecutorCandidate[],
): EscalationDecision {
  const { score, reasonCodes } = escalationScore(evidence);
  const justified = score >= 4;

  if (!justified) {
    return {
      action: "stay-local",
      justified: false,
      score,
      reasonCodes,
      candidate: null,
      reason:
        "Local execution has not produced enough evidence of a capability miss to justify paid escalation.",
    };
  }

  const candidate = chooseCandidate(candidates, evidence);
  if (!candidate) {
    return {
      action: "no-qualified-executor",
      justified: true,
      score,
      reasonCodes,
      candidate: null,
      reason:
        "Escalation is justified, but no currently available paid or business-owned executor meets the task requirements.",
    };
  }

  const marginalCost = candidate.estimatedMarginalCostUsd;
  const budget = evidence.automaticPaidBudgetUsd ?? 0;
  const effectivelyFree =
    candidate.businessOwned === true &&
    typeof marginalCost === "number" &&
    marginalCost === 0;

  if (effectivelyFree) {
    return {
      action: "escalate",
      justified: true,
      score,
      reasonCodes,
      candidate,
      reason:
        "A qualified business-owned executor is available with no known incremental paid cost.",
    };
  }

  if (!evidence.allowPaidFallback) {
    return {
      action: "approval-required",
      justified: true,
      score,
      reasonCodes,
      candidate,
      reason:
        "A stronger executor is justified, but paid escalation has not been authorized for this task.",
    };
  }

  if (
    typeof marginalCost !== "number" ||
    !Number.isFinite(marginalCost) ||
    marginalCost < 0
  ) {
    return {
      action: "approval-required",
      justified: true,
      score,
      reasonCodes,
      candidate,
      reason:
        "A stronger executor is justified, but its marginal cost is unknown and cannot be auto-approved.",
    };
  }

  if (marginalCost > budget) {
    return {
      action: "approval-required",
      justified: true,
      score,
      reasonCodes,
      candidate,
      reason: `The selected executor is justified, but its estimated marginal cost ($${marginalCost.toFixed(
        4,
      )}) exceeds the automatic paid budget ($${budget.toFixed(4)}).`,
    };
  }

  return {
    action: "escalate",
    justified: true,
    score,
    reasonCodes,
    candidate,
    reason:
      "A qualified stronger executor is justified and fits within the explicitly authorized automatic paid budget.",
  };
}
