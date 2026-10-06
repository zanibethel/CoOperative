export type SemanticRepairCategory =
  | "face"
  | "hands"
  | "anatomy"
  | "skin"
  | "lighting"
  | "background"
  | "prompt"
  | "artifact";

export type SemanticRepairSeverity = "low" | "medium" | "high" | "critical";

export type SemanticRepairAction =
  | "none"
  | "refine-face"
  | "refine-hands"
  | "refine-anatomy"
  | "refine-skin"
  | "refine-lighting"
  | "inpaint"
  | "regenerate"
  | "upscale";

export type SemanticRepairFinding = {
  category: SemanticRepairCategory;
  severity: SemanticRepairSeverity;
  description: string;
  regionHint?: string | null;
  action: SemanticRepairAction;
};

export type SemanticRepairReport = {
  overallScore: number;
  promptAdherence: number;
  faceQuality: number | null;
  handQuality: number | null;
  anatomyQuality: number | null;
  skinRealism: number | null;
  lightingConsistency: number;
  backgroundIntegrity: number;
  artifactSeverity: number;
  confidence: number;
  findings: SemanticRepairFinding[];
  suggestedActions: string[];
};

export type RepairPlanTarget = {
  category: SemanticRepairCategory;
  score: number | null;
  severity: SemanticRepairSeverity;
  requestedAction: SemanticRepairAction;
  plannedAction: SemanticRepairAction;
  priority: number;
  regionHint: string | null;
  reason: string;
};

export type RepairConsistencyIssue = {
  code:
    | "low-confidence"
    | "score-visibility-conflict"
    | "severity-action-conflict"
    | "score-severity-conflict"
    | "prompt-regeneration-required"
    | "region-repair-not-yet-supported";
  category?: SemanticRepairCategory;
  detail: string;
};

export type MediaRepairPlanV1 = {
  version: "repair-planner-v1";
  decision: "accept" | "repair" | "regenerate" | "review";
  autoRepairEligible: boolean;
  autoExecute: false;
  targets: RepairPlanTarget[];
  consistencyIssues: RepairConsistencyIssue[];
  protectedCategories: SemanticRepairCategory[];
  plannerNotes: string[];
  baseline: {
    overallScore: number;
    promptAdherence: number;
    artifactSeverity: number;
    confidence: number;
  };
};

const UNCERTAINTY_PATTERN =
  /\b(?:not visible|cannot (?:be )?judg|can't (?:be )?judg|unclear|not enough detail|insufficient detail|not visible enough|partially obscured|obscured)\b/i;

const SCORE_BY_CATEGORY = {
  face: (report: SemanticRepairReport) => report.faceQuality,
  hands: (report: SemanticRepairReport) => report.handQuality,
  anatomy: (report: SemanticRepairReport) => report.anatomyQuality,
  skin: (report: SemanticRepairReport) => report.skinRealism,
  lighting: (report: SemanticRepairReport) => report.lightingConsistency,
  background: (report: SemanticRepairReport) => report.backgroundIntegrity,
  prompt: (report: SemanticRepairReport) => report.promptAdherence,
  artifact: (report: SemanticRepairReport) => 100 - report.artifactSeverity,
} satisfies Record<
  SemanticRepairCategory,
  (report: SemanticRepairReport) => number | null
>;

const ACTION_BY_CATEGORY: Partial<
  Record<SemanticRepairCategory, SemanticRepairAction>
> = {
  face: "refine-face",
  hands: "refine-hands",
  anatomy: "refine-anatomy",
  skin: "refine-skin",
  lighting: "refine-lighting",
  background: "inpaint",
  prompt: "regenerate",
  artifact: "inpaint",
};

const SEVERITY_WEIGHT: Record<SemanticRepairSeverity, number> = {
  low: 0,
  medium: 15,
  high: 30,
  critical: 45,
};

function scoreForCategory(
  report: SemanticRepairReport,
  category: SemanticRepairCategory,
) {
  return SCORE_BY_CATEGORY[category](report);
}

function findingPriority(
  finding: SemanticRepairFinding,
  score: number | null,
) {
  const scorePenalty = score === null ? 0 : Math.max(0, 85 - score);
  return Math.min(100, scorePenalty + SEVERITY_WEIGHT[finding.severity]);
}

function repairThreshold(category: SemanticRepairCategory) {
  if (category === "lighting" || category === "background") return 70;
  if (category === "prompt") return 72;
  if (category === "artifact") return 65;
  return 78;
}

function isStrongSeverity(severity: SemanticRepairSeverity) {
  return severity === "high" || severity === "critical";
}

export function planMediaRepair(
  report: SemanticRepairReport,
): MediaRepairPlanV1 {
  const consistencyIssues: RepairConsistencyIssue[] = [];
  const protectedCategories = new Set<SemanticRepairCategory>();
  const targets: RepairPlanTarget[] = [];
  const plannerNotes: string[] = [];

  if (report.confidence < 0.65) {
    consistencyIssues.push({
      code: "low-confidence",
      detail: `Semantic judge confidence ${report.confidence.toFixed(
        2,
      )} is below the 0.65 automatic-repair threshold.`,
    });
  }

  for (const finding of report.findings) {
    const score = scoreForCategory(report, finding.category);
    const uncertain = UNCERTAINTY_PATTERN.test(finding.description);

    if (uncertain) {
      protectedCategories.add(finding.category);
      if (score !== null) {
        consistencyIssues.push({
          code: "score-visibility-conflict",
          category: finding.category,
          detail:
            `${finding.category} received score ${score} even though the finding says visibility is insufficient. The score is excluded from automatic repair planning.`,
        });
      }
      continue;
    }

    const threshold = repairThreshold(finding.category);
    const scoreSupportsRepair = score !== null && score < threshold;
    const severitySupportsRepair =
      finding.severity === "medium" || isStrongSeverity(finding.severity);

    if (
      finding.action === "none" &&
      severitySupportsRepair &&
      score !== null &&
      score < 85
    ) {
      consistencyIssues.push({
        code: "severity-action-conflict",
        category: finding.category,
        detail:
          `${finding.category} is marked ${finding.severity} at score ${score}, but the judge requested no action. The deterministic planner may derive an action instead.`,
      });
    }

    if (
      isStrongSeverity(finding.severity) &&
      score !== null &&
      score >= 88
    ) {
      consistencyIssues.push({
        code: "score-severity-conflict",
        category: finding.category,
        detail:
          `${finding.category} is marked ${finding.severity} while its score is ${score}. Automatic repair is blocked for this contradictory dimension.`,
      });
      protectedCategories.add(finding.category);
      continue;
    }

    if (!scoreSupportsRepair && !isStrongSeverity(finding.severity)) {
      continue;
    }

    const derivedAction =
      finding.action !== "none"
        ? finding.action
        : ACTION_BY_CATEGORY[finding.category] || "none";

    if (derivedAction === "none") continue;

    if (derivedAction === "regenerate") {
      consistencyIssues.push({
        code: "prompt-regeneration-required",
        category: finding.category,
        detail:
          "The prompt mismatch is large enough that repair would require regeneration rather than a bounded detail pass.",
      });
    }

    if (
      (derivedAction === "inpaint" || finding.regionHint) &&
      (finding.category === "background" || finding.category === "artifact")
    ) {
      consistencyIssues.push({
        code: "region-repair-not-yet-supported",
        category: finding.category,
        detail:
          "The current repair executor does not yet have semantic region masks/inpainting, so this target remains planned but cannot auto-execute.",
      });
    }

    targets.push({
      category: finding.category,
      score,
      severity: finding.severity,
      requestedAction: finding.action,
      plannedAction: derivedAction,
      priority: findingPriority(finding, score),
      regionHint: finding.regionHint || null,
      reason: finding.description,
    });
  }

  if (
    report.artifactSeverity >= 40 &&
    !protectedCategories.has("artifact") &&
    !targets.some((target) => target.category === "artifact")
  ) {
    targets.push({
      category: "artifact",
      score: 100 - report.artifactSeverity,
      severity: report.artifactSeverity >= 70 ? "high" : "medium",
      requestedAction: "none",
      plannedAction: "inpaint",
      priority: Math.min(100, report.artifactSeverity),
      regionHint: null,
      reason: `Artifact severity is ${report.artifactSeverity}/100.`,
    });
    consistencyIssues.push({
      code: "region-repair-not-yet-supported",
      category: "artifact",
      detail:
        "Artifact cleanup requires region-aware inpainting before it can auto-execute.",
    });
  }

  targets.sort((a, b) => b.priority - a.priority);

  const regenerationTarget = targets.find(
    (target) => target.plannedAction === "regenerate",
  );
  const executableDetailTargets = targets.filter((target) =>
    [
      "refine-face",
      "refine-hands",
      "refine-anatomy",
      "refine-skin",
      "refine-lighting",
      "upscale",
    ].includes(target.plannedAction),
  );

  const hasContradictoryProtectedDimension = consistencyIssues.some(
    (issue) =>
      issue.code === "score-severity-conflict" ||
      issue.code === "low-confidence",
  );

  let decision: MediaRepairPlanV1["decision"] = "accept";
  if (report.confidence < 0.65 || hasContradictoryProtectedDimension) {
    decision = "review";
  } else if (regenerationTarget || report.promptAdherence < 72) {
    decision = "regenerate";
  } else if (executableDetailTargets.length > 0 || targets.length > 0) {
    decision = "repair";
  }

  const autoRepairEligible =
    decision === "repair" &&
    report.confidence >= 0.75 &&
    executableDetailTargets.length > 0 &&
    !regenerationTarget &&
    !consistencyIssues.some(
      (issue) =>
        issue.code === "low-confidence" ||
        issue.code === "score-severity-conflict",
    );

  if (decision === "accept") {
    plannerNotes.push(
      "No bounded repair target cleared the deterministic quality threshold.",
    );
  } else if (decision === "repair") {
    plannerNotes.push(
      `${executableDetailTargets.length} bounded detail target(s) are eligible for the next repair executor.`,
    );
  } else if (decision === "regenerate") {
    plannerNotes.push(
      "The plan recommends regeneration rather than a low-strength detail repair.",
    );
  } else {
    plannerNotes.push(
      "The report contains confidence or consistency conflicts that require another judge or manual review before mutation.",
    );
  }

  if (
    report.overallScore >= 88 &&
    report.promptAdherence >= 85 &&
    !targets.length
  ) {
    plannerNotes.push("High-scoring result protected from unnecessary extra passes.");
  }

  return {
    version: "repair-planner-v1",
    decision,
    autoRepairEligible,
    autoExecute: false,
    targets,
    consistencyIssues,
    protectedCategories: [...protectedCategories],
    plannerNotes,
    baseline: {
      overallScore: report.overallScore,
      promptAdherence: report.promptAdherence,
      artifactSeverity: report.artifactSeverity,
      confidence: report.confidence,
    },
  };
}
