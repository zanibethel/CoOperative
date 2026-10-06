import type {
  MediaRepairPlanV1,
  RepairPlanTarget,
} from "@/lib/inference/media-repair-planner";

const EXECUTABLE_ACTIONS = new Set([
  "refine-face",
  "refine-hands",
  "refine-anatomy",
  "refine-skin",
  "refine-lighting",
]);

export type ExecutableRepairTarget = RepairPlanTarget & {
  plannedAction:
    | "refine-face"
    | "refine-hands"
    | "refine-anatomy"
    | "refine-skin"
    | "refine-lighting";
};

export function executableRepairTargets(
  plan: MediaRepairPlanV1 | null | undefined,
  limit = 2,
): ExecutableRepairTarget[] {
  if (!plan?.autoRepairEligible || !Array.isArray(plan.targets)) return [];

  return plan.targets
    .filter(
      (target): target is ExecutableRepairTarget =>
        EXECUTABLE_ACTIONS.has(target.plannedAction),
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, Math.min(3, limit)));
}

function instructionForTarget(target: ExecutableRepairTarget) {
  switch (target.plannedAction) {
    case "refine-face":
      return "improve facial coherence, realistic feature geometry, and fine facial detail";
    case "refine-hands":
      return "improve hand and finger anatomy, natural proportions, and realistic hand detail";
    case "refine-anatomy":
      return "improve visible limb/body anatomical coherence and realistic proportions";
    case "refine-skin":
      return "improve natural skin texture and preserve realistic, non-plastic surface detail";
    case "refine-lighting":
      return "improve local lighting consistency, believable shadows, and subject-to-scene integration";
  }
}

export function boundedRepairPrompt(
  sourcePrompt: string,
  targets: ExecutableRepairTarget[],
) {
  const targetInstructions = targets.map(instructionForTarget).join("; ");

  return [
    sourcePrompt.trim(),
    "",
    "Bounded repair pass.",
    "Preserve the existing composition, camera framing, pose, subject identity, clothing, background, color balance, and all already-good details.",
    `Change only what is necessary to: ${targetInstructions}.`,
    "Keep the repair subtle and photographic. Do not introduce new objects, people, text, limbs, accessories, or scene changes.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function boundedRepairStrength(targets: ExecutableRepairTarget[]) {
  if (targets.some((target) => target.plannedAction === "refine-anatomy")) {
    return 0.18;
  }
  return 0.16;
}

export function boundedRepairSeed(
  sourceSeed: number | null | undefined,
  attempt = 1,
) {
  if (typeof sourceSeed !== "number" || !Number.isFinite(sourceSeed)) {
    return null;
  }
  return (Math.trunc(sourceSeed) + Math.max(1, attempt) + 1) % 2147483648;
}

export function candidateRepairPlan(
  plan: MediaRepairPlanV1,
  targets: ExecutableRepairTarget[],
) {
  return {
    ...plan,
    targets,
    executor: {
      version: "bounded-img2img-v1",
      automaticCandidate: true,
      promotionRequiresPairwiseVerification: true,
      maxTargetsPerAttempt: 2,
    },
  };
}
