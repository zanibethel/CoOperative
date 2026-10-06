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
  confidence: number;
};

export function decidePairwiseVerification(
  report: PairwiseVerificationReport,
  expectedTargetCategories: string[] = [],
): PairwiseVerificationDecision {
  const reasons: string[] = [];
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
    reasons.push(
      `Verifier target mismatch. Expected [${expectedTargets.join(
        ", ",
      )}] but received [${reportedTargets.join(", ")}].`,
    );
  }
  const anyBetter = report.targetResults.some(
    (result) => result.result === "better",
  );
  const anyWorse = report.targetResults.some(
    (result) => result.result === "worse",
  );
  const allSame = report.targetResults.every(
    (result) => result.result === "same",
  );
  const anyUncertain = report.targetResults.some(
    (result) => result.result === "uncertain",
  );
  const materialRegression = report.regressions.some(
    (regression) =>
      regression.severity === "high" || regression.severity === "critical",
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
  if (materialRegression) {
    reasons.push("A high or critical regression was detected outside the target.");
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
    !materialRegression &&
    report.promptAdherenceComparison !== "worse" &&
    report.compositionPreservation !== "changed-material" &&
    !anyUncertain;

  let verdict: PairwiseVerificationDecision["verdict"] = "review";
  if (acceptCandidate) {
    verdict = "candidate-better";
  } else if (!targetSetMatches) {
    verdict = "review";
  } else if (
    anyWorse ||
    materialRegression ||
    report.promptAdherenceComparison === "worse" ||
    report.compositionPreservation === "changed-material"
  ) {
    verdict = "original-better";
  } else if (
    allSame &&
    report.promptAdherenceComparison === "same" &&
    !report.regressions.length
  ) {
    verdict = "equivalent";
  }

  if (acceptCandidate) {
    reasons.push(
      "Candidate improves the targeted dimension without a material regression.",
    );
  }

  return {
    version: "pairwise-decision-v1",
    verdict,
    acceptCandidate,
    reasons,
    confidence: report.confidence,
  };
}
