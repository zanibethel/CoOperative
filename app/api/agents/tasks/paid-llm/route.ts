import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import {
  evaluatePaidEscalation,
  type EscalationEvidence,
} from "@/lib/inference/escalation-evaluator";
import {
  configuredBusinessOpenAiCandidate,
  configuredOpenAiCandidate,
  executeOpenAiPaidText,
} from "@/lib/inference/openai-paid-executor";
import { localWorkerAuthorized } from "@/lib/agents/server";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";

export const runtime = "nodejs";
export const maxDuration = 210;

const schema = z.object({
  taskId: z.string().uuid(),
  messages: z.array(textInferenceMessageSchema).min(1).max(20),
  maxTokens: z.number().int().min(64).max(4096).default(2400),
  temperature: z.number().min(0).max(1).default(0.1),
});

type ExecutorApproval = {
  provider?: unknown;
  model?: unknown;
  approvedMaxCostUsd?: unknown;
  estimatedCostUsd?: unknown;
  sourceTaskId?: unknown;
};

export async function POST(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    const { data: task, error } = await admin
      .from("agent_tasks")
      .select("id,owner_ref,status,result")
      .eq("id", input.taskId)
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (!["running", "waiting_llm"].includes(task.status)) {
      return NextResponse.json(
        { error: `Task is not active: ${task.status}` },
        { status: 409 },
      );
    }

    const taskResult =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : {};
    const approval =
      taskResult.executorApproval &&
      typeof taskResult.executorApproval === "object"
        ? (taskResult.executorApproval as ExecutorApproval)
        : null;

    const provider =
      approval && typeof approval.provider === "string" ? approval.provider : "";
    const model =
      approval && typeof approval.model === "string" ? approval.model : "";
    const approvedMaxCostUsd =
      approval && typeof approval.approvedMaxCostUsd === "number"
        ? approval.approvedMaxCostUsd
        : null;

    if (!provider || !model || approvedMaxCostUsd === null) {
      return NextResponse.json(
        { error: "This task has no valid human-approved stronger executor budget." },
        { status: 409 },
      );
    }

    const evidence: EscalationEvidence = {
      taskClass: "coding",
      localProfile: "quality",
      messages: input.messages,
      requestedOutputTokens: input.maxTokens,
      localAttempts: 2,
      localFailures: 1,
      verificationStatus: "inconclusive",
      allowPaidFallback: true,
      automaticPaidBudgetUsd: approvedMaxCostUsd,
      requiredSuccessRate: 0.8,
    };

    const businessOpenAiService =
      await businessOwnedServiceCredentialForOwner(
        task.owner_ref,
        "openai-api",
      );
    const businessOpenAi = businessOpenAiService
      ? configuredBusinessOpenAiCandidate(evidence)
      : null;
    const platformOpenAi = configuredOpenAiCandidate(evidence);
    const candidates = [businessOpenAi, platformOpenAi].filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
    );
    const decision = evaluatePaidEscalation(evidence, candidates);

    if (
      decision.action !== "escalate" ||
      !decision.candidate ||
      decision.candidate.provider !== provider ||
      decision.candidate.model !== model
    ) {
      return NextResponse.json(
        {
          error:
            "The approved stronger executor no longer satisfies current qualification/cost policy.",
          decision,
        },
        { status: 409 },
      );
    }

    if (provider !== "openai") {
      return NextResponse.json(
        { error: `Paid executor adapter is not implemented for provider: ${provider}` },
        { status: 501 },
      );
    }

    const usingBusinessOwnedAi =
      decision.candidate.id === "business-openai";

    if (usingBusinessOwnedAi && !businessOpenAiService) {
      return NextResponse.json(
        { error: "The business-owned AI connection is no longer available." },
        { status: 409 },
      );
    }

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "paid_llm_started",
      message: usingBusinessOwnedAi
        ? "Approved reasoning started on the business-owned AI account."
        : "Approved stronger-model reasoning started.",
      metadata: {
        provider,
        model,
        executorSource: usingBusinessOwnedAi
          ? "business-connected-service"
          : "cooperative-platform",
        approvedMaxCostUsd,
        estimatedCostUsd: decision.candidate.estimatedMarginalCostUsd,
      },
    });

    const result = await executeOpenAiPaidText(evidence, {
      apiKey: usingBusinessOwnedAi
        ? businessOpenAiService?.credential
        : undefined,
      model: decision.candidate.model,
    });

    if (
      typeof result.estimatedCostUsd === "number" &&
      result.estimatedCostUsd > approvedMaxCostUsd + 1e-9
    ) {
      await admin.from("agent_task_events").insert({
        task_id: task.id,
        owner_ref: task.owner_ref,
        kind: "paid_llm_budget_warning",
        message:
          "Reported estimated paid-model cost exceeded the approved ceiling after execution.",
        metadata: {
          provider,
          model: result.model,
          approvedMaxCostUsd,
          estimatedCostUsd: result.estimatedCostUsd,
        },
      });

      return NextResponse.json(
        {
          error:
            "Paid model completed but reported estimated cost exceeded the approved ceiling; result was quarantined.",
        },
        { status: 409 },
      );
    }

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "paid_llm_completed",
      message: "Approved stronger-model reasoning completed.",
      metadata: {
        provider,
        model: result.model,
        responseId: result.responseId,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        approvedMaxCostUsd,
        executorSource: usingBusinessOwnedAi
          ? "business-connected-service"
          : "cooperative-platform",
      },
    });

    return NextResponse.json(
      {
        status: "completed",
        text: result.text,
        model: result.model,
        provider: result.provider,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: result.estimatedCostUsd,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not run approved paid agent reasoning.";

    return NextResponse.json(
      {
        error: "Could not run approved paid agent reasoning.",
        detail: detail.slice(0, 1200),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
