import type { ExecutorCandidate, ExecutorKind } from "../domain/operative-schemas.ts";

/**
 * Cost-aware executor router.
 *
 * Implements docs/CORE-OPERATING-MODEL.md "Execution economics: use the lowest
 * marginal-cost qualified executor":
 *
 *   known deterministic automation
 *     -> connected owner-paid assistant/tooling when available and qualified
 *     -> native CoOperative capability
 *     -> Hermes / Cloud Operative when autonomy, shell access, persistence,
 *        or unavailable tools are required
 *     -> paid external AI only for the reasoning that remains
 *
 * This module never talks to a specific provider. It only ranks executor
 * candidates that the caller has already probed for availability/qualification,
 * and returns a reasoned selection. The playbook/task layer is responsible for
 * actually invoking the chosen executor and writing results back to the
 * canonical task/decision/audit state (docs/CLOUD-OPERATIVE.md "Cost-aware
 * executor selection": "every executor must write results ... back to
 * CoOperative's canonical system").
 */

/** Priority order used only as a tie-breaker when marginal cost is equal. */
const EXECUTOR_PRIORITY: Record<ExecutorKind, number> = {
  "deterministic-code": 0,
  "connected-chatgpt": 1,
  "native-capability": 2,
  "hermes-cloud-operative": 3,
  "external-ai-provider": 4,
};

export interface ExecutorSelection {
  selected: ExecutorCandidate | null;
  reason: string;
  /** Other candidates considered, in the order they were ranked. */
  ranked: ExecutorCandidate[];
}

/**
 * Select the lowest-marginal-cost qualified executor.
 *
 * Rules enforced (see docs/CORE-OPERATING-MODEL.md):
 * - only `available && qualified` candidates are eligible;
 * - a candidate that `requiresAutonomousExecution` can only be satisfied by
 *   `hermes-cloud-operative` (shell/terminal/persistent background work) —
 *   ChatGPT/native-capability candidates are filtered out for those tasks
 *   even if they report available/qualified, since they cannot provide
 *   cloud autonomy, terminal access, or persistent task state;
 * - among the remaining eligible candidates, lowest `estimatedMarginalCostMicrounits`
 *   wins; ties broken by the fixed priority order above (deterministic code
 *   first, paid external AI last);
 * - do not select `connected-chatgpt` when the task requires background
 *   execution that must survive without an active owner-side conversation
 *   (docs/CORE-OPERATING-MODEL.md: "customer runtime must not depend on the
 *   owner having an active ChatGPT conversation open").
 */
export function selectExecutor(candidates: ExecutorCandidate[]): ExecutorSelection {
  const needsAutonomy = candidates.some((c) => c.requiresAutonomousExecution);

  const eligible = candidates.filter((c) => {
    if (!c.available || !c.qualified) return false;
    if (needsAutonomy && c.kind !== "hermes-cloud-operative") return false;
    return true;
  });

  if (eligible.length === 0) {
    return {
      selected: null,
      reason: needsAutonomy
        ? "Task requires autonomous/persistent execution but no available+qualified hermes-cloud-operative candidate was provided."
        : "No available and qualified executor candidate was provided.",
      ranked: [],
    };
  }

  const ranked = [...eligible].sort((a, b) => {
    if (a.estimatedMarginalCostMicrounits !== b.estimatedMarginalCostMicrounits) {
      return a.estimatedMarginalCostMicrounits - b.estimatedMarginalCostMicrounits;
    }
    return EXECUTOR_PRIORITY[a.kind] - EXECUTOR_PRIORITY[b.kind];
  });

  const selected = ranked[0];
  const reason =
    selected.estimatedMarginalCostMicrounits === 0
      ? `Selected ${selected.kind}: zero marginal cost (covered by deterministic code or an existing flat-rate/owner-paid connection).`
      : `Selected ${selected.kind}: lowest marginal cost among qualified executors (${selected.estimatedMarginalCostMicrounits}\u00a2).`;

  return { selected, reason, ranked };
}

/**
 * Guard used by task executors before dispatching work to a candidate.
 * Executor choice must never bypass approval/permission/audit/security rules
 * (docs/CORE-OPERATING-MODEL.md), so high-risk candidates are only usable once
 * the caller confirms an owner approval already exists for this task.
 */
export function requiresApprovalBeforeDispatch(candidate: ExecutorCandidate): boolean {
  return candidate.riskLevel !== "low";
}
