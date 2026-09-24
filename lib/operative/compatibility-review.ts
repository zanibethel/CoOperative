import {
  INTEGRATION_COMPATIBILITY_RULES,
  type CompatibilityRule,
  type CompatibilityTarget,
} from "./integration-compatibility-registry.ts";

export interface CompatibilityReview {
  ok: boolean;
  targets: CompatibilityTarget[];
  ruleIds: string[];
  uncoveredTargets: CompatibilityTarget[];
  rules: CompatibilityRule[];
  brief: string;
}

/**
 * Deterministic preflight run before any allow-listed Cloud Operative playbook.
 *
 * A new integration target fails closed until at least one reviewed registry
 * rule covers it. This prevents code, shell, or AI execution from silently
 * bypassing prior integration knowledge.
 */
export function reviewCompatibilityKnowledge(
  requestedTargets: readonly CompatibilityTarget[],
): CompatibilityReview {
  const targets = [...new Set(requestedTargets)];
  const rules = INTEGRATION_COMPATIBILITY_RULES.filter((rule) =>
    rule.targets.some((target) => targets.includes(target)),
  );
  const uncoveredTargets = targets.filter(
    (target) => !rules.some((rule) => rule.targets.includes(target)),
  );

  const brief = rules
    .map((rule) => `${rule.id}: ${rule.knownGoodPattern}`)
    .join("\n");

  return {
    ok: uncoveredTargets.length === 0,
    targets,
    ruleIds: rules.map((rule) => rule.id),
    uncoveredTargets,
    rules,
    brief,
  };
}
