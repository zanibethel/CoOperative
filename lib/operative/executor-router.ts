import type {
  ExecutorCandidate,
  ExecutorCapability,
  ExecutorKind,
  ExecutorRequirements,
} from "../domain/operative-schemas.ts";

/**
 * Cost-aware executor router.
 *
 * CoOperative owns the task, policy, cost envelope, state, and evidence.
 * Executors are replaceable implementations selected by capability rather than
 * by provider name.
 *
 * Preferred direction:
 *
 *   deterministic/playbook work
 *     -> flat-rate/owner-paid connected executor when qualified
 *     -> native CoOperative capability
 *     -> approved external agent/runtime
 *     -> Hermes when it is the best qualified runtime
 *     -> stronger/more expensive AI only when required
 *     -> human executor for irreducibly human work
 *
 * The persisted executor enum is intentionally unchanged in this slice. A
 * provider such as a general-purpose external agent runtime is represented by
 * `external-ai-provider` plus a `providerKey` until a separately reviewed
 * database migration expands the canonical enum.
 */

/** Priority order used only after cost and quality are tied. */
const EXECUTOR_PRIORITY: Record<ExecutorKind, number> = {
  "deterministic-code": 0,
  "connected-chatgpt": 1,
  "native-capability": 2,
  "external-ai-provider": 3,
  "hermes-cloud-operative": 4,
};

const INFERRED_CAPABILITIES: Record<ExecutorKind, readonly ExecutorCapability[]> = {
  "deterministic-code": ["deterministic", "verification"],
  "connected-chatgpt": ["reasoning", "research", "connected-tools", "verification"],
  "native-capability": ["deterministic", "connected-tools", "verification"],
  "hermes-cloud-operative": [
    "reasoning",
    "research",
    "browser-automation",
    "code-edit",
    "shell",
    "deploy",
    "scheduled-work",
    "autonomous-execution",
    "persistent-workspace",
    "verification",
  ],
  "external-ai-provider": ["reasoning"],
};

export interface ExecutorSelection {
  selected: ExecutorCandidate | null;
  reason: string;
  /** Other candidates considered, in the order they were ranked. */
  ranked: ExecutorCandidate[];
}

function capabilitiesFor(candidate: ExecutorCandidate): Set<ExecutorCapability> {
  const declared =
    candidate.capabilities && candidate.capabilities.length > 0
      ? candidate.capabilities
      : INFERRED_CAPABILITIES[candidate.kind];

  return new Set(declared);
}

function legacyRequirements(candidates: ExecutorCandidate[]): ExecutorRequirements {
  return {
    requiredCapabilities: [],
    requiresAutonomousExecution: candidates.some(
      (candidate) => candidate.requiresAutonomousExecution,
    ),
    minimumQualityScore: 0,
  };
}

function satisfiesRequirements(
  candidate: ExecutorCandidate,
  requirements: ExecutorRequirements,
) {
  if (!candidate.available || !candidate.qualified) return false;

  if (
    requirements.maxMarginalCostMicrounits !== undefined &&
    candidate.estimatedMarginalCostMicrounits >
      requirements.maxMarginalCostMicrounits
  ) {
    return false;
  }

  if (
    requirements.minimumQualityScore > 0 &&
    (candidate.qualityScore === undefined ||
      candidate.qualityScore < requirements.minimumQualityScore)
  ) {
    return false;
  }

  const capabilities = capabilitiesFor(candidate);

  if (
    requirements.requiresAutonomousExecution &&
    !capabilities.has("autonomous-execution")
  ) {
    return false;
  }

  return requirements.requiredCapabilities.every((capability) =>
    capabilities.has(capability),
  );
}

/**
 * Select the lowest-marginal-cost qualified executor that satisfies the task's
 * capability, autonomy, quality, and spend requirements.
 *
 * New callers should pass explicit ExecutorRequirements. If requirements are
 * omitted, the router preserves the older bootstrap behavior where
 * `requiresAutonomousExecution` was carried on candidate objects.
 */
export function selectExecutor(
  candidates: ExecutorCandidate[],
  requirements?: ExecutorRequirements,
): ExecutorSelection {
  const resolvedRequirements = requirements ?? legacyRequirements(candidates);

  const eligible = candidates.filter((candidate) =>
    satisfiesRequirements(candidate, resolvedRequirements),
  );

  if (eligible.length === 0) {
    const missing = [
      ...resolvedRequirements.requiredCapabilities,
      ...(resolvedRequirements.requiresAutonomousExecution
        ? (["autonomous-execution"] as ExecutorCapability[])
        : []),
    ];

    return {
      selected: null,
      reason:
        missing.length > 0
          ? `No available and qualified executor satisfies required capabilities: ${[
              ...new Set(missing),
            ].join(", ")}.`
          : "No available and qualified executor fits the task cost/quality requirements.",
      ranked: [],
    };
  }

  const ranked = [...eligible].sort((a, b) => {
    if (
      a.estimatedMarginalCostMicrounits !==
      b.estimatedMarginalCostMicrounits
    ) {
      return (
        a.estimatedMarginalCostMicrounits -
        b.estimatedMarginalCostMicrounits
      );
    }

    const qualityA = a.qualityScore ?? 0;
    const qualityB = b.qualityScore ?? 0;
    if (qualityA !== qualityB) return qualityB - qualityA;

    const latencyA = a.estimatedLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const latencyB = b.estimatedLatencyMs ?? Number.MAX_SAFE_INTEGER;
    if (latencyA !== latencyB) return latencyA - latencyB;

    return EXECUTOR_PRIORITY[a.kind] - EXECUTOR_PRIORITY[b.kind];
  });

  const selected = ranked[0];
  const providerSuffix = selected.providerKey
    ? ` (${selected.providerKey})`
    : "";

  const reason =
    selected.estimatedMarginalCostMicrounits === 0
      ? `Selected ${selected.kind}${providerSuffix}: lowest marginal cost and all task requirements are satisfied.`
      : `Selected ${selected.kind}${providerSuffix}: lowest marginal cost among qualified executors that satisfy the task requirements (${selected.estimatedMarginalCostMicrounits} microunits).`;

  return { selected, reason, ranked };
}

/**
 * Guard used by task executors before dispatching work to a candidate.
 * Executor choice must never bypass approval/permission/audit/security rules.
 */
export function requiresApprovalBeforeDispatch(
  candidate: ExecutorCandidate,
): boolean {
  return candidate.riskLevel !== "low";
}
