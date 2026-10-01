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

export const runtime = "nodejs";
export const maxDuration = 210;

const requestSchema = z.object({
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
    const evidence = input.evidence as EscalationEvidence;
    const openAiCandidate = configuredOpenAiCandidate(evidence);
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

    const result = await executeOpenAiPaidText(evidence);

    return NextResponse.json(
      {
        executed: true,
        decision,
        result,
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
