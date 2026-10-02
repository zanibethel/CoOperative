import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluatePaidEscalation,
  type EscalationEvidence,
} from "@/lib/inference/escalation-evaluator";
import {
  configuredOpenAiCandidate,
  executeOpenAiPaidText,
} from "@/lib/inference/openai-paid-executor";
import {
  textInferenceMessageSchema,
  textTaskClassSchema,
} from "@/lib/inference/contracts";
import {
  aiProfileBalanceForOwnerRef,
  profileRefFromAiOwnerRef,
  releaseAiProfileFunds,
  reserveAiProfileFunds,
  settleAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";

export const runtime = "nodejs";
export const maxDuration = 210;

const requestSchema = z.object({
  ownerRef: z.string().min(1).max(200),
  evidence: z.object({
    taskClass: textTaskClassSchema,
    localProfile: z.enum(["fast", "quality"]),
    messages: z.array(textInferenceMessageSchema).min(1).max(40),
    requestedOutputTokens: z.number().int().min(16).max(4096),
    localAttempts: z.number().int().min(0).max(20),
    localFailures: z.number().int().min(0).max(20),
    malformedStructuredOutputs: z.number().int().min(0).max(20).optional(),
    scopeGuardRejections: z.number().int().min(0).max(20).optional(),
    verificationStatus: z.enum(["not_run", "passed", "failed", "inconclusive"]),
    allowPaidFallback: z.boolean(),
    automaticPaidBudgetUsd: z.number().min(0).max(1000).optional(),
    requiredSuccessRate: z.number().min(0).max(1).optional(),
  }),
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
    const profileRef = profileRefFromAiOwnerRef(input.ownerRef);
    const profileBalance = await aiProfileBalanceForOwnerRef(input.ownerRef);
    const requestedEvidence = input.evidence as EscalationEvidence;
    const fundedBalanceUsd = profileBalance?.availableUsd ?? 0;
    const requestedBudget = requestedEvidence.automaticPaidBudgetUsd ?? 0;
    const evidence: EscalationEvidence = {
      ...requestedEvidence,
      allowPaidFallback:
        requestedEvidence.allowPaidFallback && profileBalance?.funded === true,
      automaticPaidBudgetUsd: Math.min(requestedBudget, fundedBalanceUsd),
      fundedPaidBalanceUsd: fundedBalanceUsd,
    };
    const openAiCandidate =
      profileBalance?.funded === true
        ? configuredOpenAiCandidate(evidence)
        : null;
    const decision = evaluatePaidEscalation(
      evidence,
      openAiCandidate ? [openAiCandidate] : [],
    );

    if (decision.action !== "escalate") {
      return NextResponse.json(
        {
          executed: false,
          decision,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (decision.candidate.provider !== "openai") {
      return NextResponse.json(
        {
          error: "Selected executor adapter is not implemented.",
          decision,
        },
        { status: 501, headers: { "Cache-Control": "no-store" } },
      );
    }

    const estimatedCostUsd = decision.candidate.estimatedMarginalCostUsd;
    if (
      !profileRef ||
      !profileBalance?.funded ||
      typeof estimatedCostUsd !== "number" ||
      !Number.isFinite(estimatedCostUsd) ||
      estimatedCostUsd <= 0
    ) {
      return NextResponse.json(
        {
          executed: false,
          decision,
          error:
            "Platform-paid AI requires a funded profile balance and a known estimated cost.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const reservation = await reserveAiProfileFunds({
      profileRef,
      estimatedCostUsd,
      source: "text-escalation",
      referenceId: crypto.randomUUID(),
      metadata: {
        provider: decision.candidate.provider,
        model: decision.candidate.model,
      },
    });

    if (!reservation) {
      return NextResponse.json(
        {
          executed: false,
          decision,
          error:
            "The profile AI balance no longer has enough available funds for this paid request.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    let result;
    try {
      result = await executeOpenAiPaidText(evidence);
    } catch (executionError) {
      await releaseAiProfileFunds({
        reservationId: reservation.id,
        metadata: { reason: "paid-ai-execution-failed" },
      });
      throw executionError;
    }

    if (
      typeof result.estimatedCostUsd !== "number" ||
      !Number.isFinite(result.estimatedCostUsd) ||
      result.estimatedCostUsd < 0
    ) {
      await releaseAiProfileFunds({
        reservationId: reservation.id,
        metadata: { reason: "paid-ai-cost-unavailable" },
      });
      return NextResponse.json(
        {
          executed: false,
          decision,
          error:
            "The paid model returned usage without a measurable configured cost; the result was quarantined.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const availableMicrousd = await settleAiProfileFunds({
      reservationId: reservation.id,
      actualCostUsd: result.estimatedCostUsd,
      metadata: {
        provider: result.provider,
        model: result.model,
        responseId: result.responseId,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
      },
    });

    return NextResponse.json(
      {
        executed: true,
        decision,
        result,
        funding: {
          reservationId: reservation.id,
          chargedUsd: result.estimatedCostUsd,
          availableMicrousd,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not execute paid escalation.";

    return NextResponse.json(
      {
        error: "Could not execute paid escalation.",
        detail: detail.slice(0, 1000),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
