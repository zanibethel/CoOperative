import { z } from "zod";

const categorySchema = z.enum([
  "face",
  "hands",
  "anatomy",
  "skin",
  "lighting",
  "background",
  "prompt",
  "artifact",
]);

const comparisonSchema = z.enum(["better", "same", "worse", "uncertain"]);

const regressionSchema = z.object({
  category: categorySchema,
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().min(1).max(500),
});

const targetResultSchema = z.object({
  category: categorySchema,
  result: comparisonSchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
});

export const pairwiseVerificationSchema = z.object({
  version: z.literal("semantic-pairwise-v1"),
  targetResults: z.array(targetResultSchema).min(1).max(8),
  promptAdherenceComparison: comparisonSchema,
  compositionPreservation: z.enum([
    "preserved",
    "changed-minor",
    "changed-material",
    "uncertain",
  ]),
  regressions: z.array(regressionSchema).max(12).default([]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(800),
});

export type PairwiseVerificationReport = z.infer<
  typeof pairwiseVerificationSchema
>;

export type PairwiseVerificationDecision = {
  version: "pairwise-decision-v1";
  verdict:
    | "candidate-better"
    | "original-better"
    | "equivalent"
    | "review";
  acceptCandidate: boolean;
  reasons: string[];
  consistencyIssues: string[];
  confidence: number;
};

export function decidePairwiseVerification(
  report: PairwiseVerificationReport,
  expectedTargetCategories: string[] = [],
): PairwiseVerificationDecision {
  const reasons: string[] = [];
  const consistencyIssues: string[] = [];

  const expectedTargets = [
    ...new Set(expectedTargetCategories.filter(Boolean)),
  ].sort();
  const reportedTargets = [
    ...new Set(report.targetResults.map((result) => result.category)),
  ].sort();

  const targetSetMatches =
    expectedTargets.length === 0 ||
    (expectedTargets.length === reportedTargets.length &&
      expectedTargets.every(
        (category, index) => category === reportedTargets[index],
      ));

  if (!targetSetMatches) {
    consistencyIssues.push(
      `Verifier target mismatch. Expected [${expectedTargets.join(
        ", ",
      )}] but received [${reportedTargets.join(", ")}].`,
    );
  }

  const targetResultMap = new Map(
    report.targetResults.map((result) => [result.category, result.result]),
  );

  const contradictoryRegressions = report.regressions.filter((regression) => {
    if (
      regression.category === "prompt" &&
      report.promptAdherenceComparison !== "worse"
    ) {
      return true;
    }

    const targetResult = targetResultMap.get(regression.category);
    return Boolean(targetResult && targetResult !== "worse");
  });

  for (const regression of contradictoryRegressions) {
    consistencyIssues.push(
      `Regression conflict: ${regression.category} is labeled ${regression.severity} regression while the direct comparison does not say that category is worse.`,
    );
  }

  const contradictorySevereRegression = contradictoryRegressions.some(
    (regression) =>
      regression.severity === "high" || regression.severity === "critical",
  );

  const effectiveRegressions = report.regressions.filter(
    (regression) => !contradictoryRegressions.includes(regression),
  );

  const decisionTargetResults = expectedTargets.length
    ? report.targetResults.filter((result) =>
        expectedTargets.includes(result.category),
      )
    : report.targetResults;

  const anyBetter = decisionTargetResults.some(
    (result) => result.result === "better",
  );
  const anyWorse = decisionTargetResults.some(
    (result) => result.result === "worse",
  );
  const allSame =
    decisionTargetResults.length > 0 &&
    decisionTargetResults.every((result) => result.result === "same");
  const anyUncertain = decisionTargetResults.some(
    (result) => result.result === "uncertain",
  );
  const meaningfulRegression = effectiveRegressions.some(
    (regression) =>
      regression.severity === "medium" ||
      regression.severity === "high" ||
      regression.severity === "critical",
  );

  if (report.confidence < 0.75) {
    reasons.push(
      `Verifier confidence ${report.confidence.toFixed(
        2,
      )} is below the 0.75 promotion threshold.`,
    );
  }
  if (anyWorse) {
    reasons.push("At least one targeted repair dimension became worse.");
  }
  if (meaningfulRegression) {
    reasons.push(
      "A medium, high, or critical regression was detected outside the repair target.",
    );
  }
  if (contradictorySevereRegression) {
    reasons.push(
      "The verifier emitted a severe regression that conflicts with its direct comparison, so promotion requires review.",
    );
  }
  if (report.promptAdherenceComparison === "worse") {
    reasons.push("Prompt adherence regressed.");
  }
  if (report.compositionPreservation === "changed-material") {
    reasons.push("The repair materially changed the original composition.");
  }
  if (anyUncertain) {
    reasons.push("At least one targeted dimension remains uncertain.");
  }
  if (!anyBetter) {
    reasons.push("No targeted repair dimension showed a clear improvement.");
  }

  const acceptCandidate =
    targetSetMatches &&
    report.confidence >= 0.75 &&
    anyBetter &&
    !anyWorse &&
    !meaningfulRegression &&
    !contradictorySevereRegression &&
    report.promptAdherenceComparison !== "worse" &&
    report.compositionPreservation !== "changed-material" &&
    !anyUncertain;

  let verdict: PairwiseVerificationDecision["verdict"] = "review";
  if (acceptCandidate) {
    verdict = "candidate-better";
  } else if (!targetSetMatches || contradictorySevereRegression) {
    verdict = "review";
  } else if (
    anyWorse ||
    meaningfulRegression ||
    report.promptAdherenceComparison === "worse" ||
    report.compositionPreservation === "changed-material"
  ) {
    verdict = "original-better";
  } else if (
    allSame &&
    report.promptAdherenceComparison === "same" &&
    effectiveRegressions.length === 0
  ) {
    verdict = "equivalent";
  }

  if (acceptCandidate) {
    reasons.push(
      "Candidate improves the targeted dimension without a meaningful regression.",
    );
  }

  return {
    version: "pairwise-decision-v1",
    verdict,
    acceptCandidate,
    reasons,
    consistencyIssues,
    confidence: report.confidence,
  };
}

