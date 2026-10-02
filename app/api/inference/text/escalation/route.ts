import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluatePaidEscalation,
  type EscalationEvidence,
  type PaidExecutorCandidate,
} from "@/lib/inference/escalation-evaluator";
import {
  textInferenceMessageSchema,
  textTaskClassSchema,
} from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 30;

const candidateSchema = z.object({
  id: z.string().min(1).max(160),
  provider: z.string().min(1).max(160),
  model: z.string().min(1).max(300),
  available: z.boolean(),
  qualified: z.boolean(),
  businessOwned: z.boolean().optional(),
  supportedTaskClasses: z.array(textTaskClassSchema).max(16).optional(),
  maxInputCharacters: z.number().int().positive().max(2_000_000).optional(),
  benchmarkSuccessRate: z.number().min(0).max(1).optional(),
  estimatedMarginalCostUsd: z.number().min(0).max(1000).optional(),
});

const requestSchema = z.object({
  evidence: z.object({
    taskClass: textTaskClassSchema,
    localProfile: z.enum(["fast", "quality"]),
    messages: z.array(textInferenceMessageSchema).min(1).max(40),
    requestedOutputTokens: z.number().int().min(16).max(4096),
    localAttempts: z.number().int().min(0).max(20),
    localFailures: z.number().int().min(0).max(20),
    localExecutionUnavailable: z.boolean().optional(),
    malformedStructuredOutputs: z.number().int().min(0).max(20).optional(),
    scopeGuardRejections: z.number().int().min(0).max(20).optional(),
    verificationStatus: z.enum(["not_run", "passed", "failed", "inconclusive"]),
    allowPaidFallback: z.boolean(),
    automaticPaidBudgetUsd: z.number().min(0).max(1000).optional(),
    fundedPaidBalanceUsd: z.number().min(0).max(1000).optional(),
    requiredSuccessRate: z.number().min(0).max(1).optional(),
  }),
  candidates: z.array(candidateSchema).max(32),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return (
    Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = requestSchema.parse(await request.json());
    const decision = evaluatePaidEscalation(
      input.evidence as EscalationEvidence,
      input.candidates as PaidExecutorCandidate[],
    );

    return NextResponse.json(
      {
        decision,
        policy: {
          automaticPaidExecutionRequiresExplicitPermission: true,
          platformPaidExecutionRequiresFundedProfileBalance: true,
          unknownCostRequiresApproval: true,
          benchmarkQualificationRequired: true,
          businessOwnedExecutorsMayBePreferredWhenQualified: true,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not evaluate paid AI escalation.";

    return NextResponse.json(
      {
        error: "Could not evaluate paid AI escalation.",
        detail: detail.slice(0, 800),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
