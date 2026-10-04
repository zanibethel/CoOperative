import { NextResponse } from "next/server";
import { z } from "zod";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
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
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import { paidHandoffMessages } from "@/lib/ai/response-support";
import { refreshRuntimeContextAfterOutcome } from "@/lib/ai/runtime-context-markdown";
import {
  aiProfileBalanceForUser,
  cooperativeProfileRef,
  releaseAiProfileFunds,
  reserveAiProfileFunds,
  settleAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";

export const runtime = "nodejs";
export const maxDuration = 210;

const requestSchema = z.object({
  jobId: z.string().uuid(),
});

const profileSchema = z.enum(["fast", "quality"]);

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();

  try {
    const input = requestSchema.parse(await request.json());

    const { data: existingFallback, error: existingError } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,conversation_id,result_text,result_model,result_provider,prompt_tokens,output_tokens,latency_ms,error",
      )
      .eq("fallback_for_job_id", input.jobId)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingFallback) {
      return NextResponse.json(
        {
          jobId: existingFallback.id,
          status: existingFallback.status,
          conversationId: existingFallback.conversation_id,
          text: existingFallback.result_text,
          model: existingFallback.result_model,
          provider: existingFallback.result_provider,
          promptTokens: existingFallback.prompt_tokens,
          outputTokens: existingFallback.output_tokens,
          latencyMs: existingFallback.latency_ms,
          error: existingFallback.error,
          execution: "paid-ai",
          reused: true,
        },
        {
          status: existingFallback.status === "completed" ? 200 : 202,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const { data: sourceJob, error: sourceError } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,client_owner_ref,conversation_id,messages,profile,max_tokens,temperature,task_class,allow_paid_fallback,capability,error,model_mixer,request_max_spend_microusd,paid_prompt_draft,paid_prompt_reason,support_packet,context_document_path,context_document_generated_at",
      )
      .eq("id", input.jobId)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();

    if (sourceError) throw sourceError;
    if (!sourceJob) {
      return NextResponse.json({ error: "Local AI job not found." }, { status: 404 });
    }
    if (sourceJob.status !== "failed") {
      return NextResponse.json(
        { error: `Paid fallback requires a failed local job, not ${sourceJob.status}.` },
        { status: 409 },
      );
    }
    if (sourceJob.allow_paid_fallback !== true || sourceJob.capability !== "text") {
      return NextResponse.json(
        { error: "This job is not eligible for funded paid fallback." },
        { status: 409 },
      );
    }
    if (!sourceJob.conversation_id) {
      return NextResponse.json(
        { error: "Paid chat fallback requires a persisted conversation." },
        { status: 409 },
      );
    }

    const parsedMessages = z
      .array(textInferenceMessageSchema)
      .min(1)
      .max(40)
      .safeParse(sourceJob.messages);
    const parsedProfile = profileSchema.safeParse(sourceJob.profile);
    const parsedTaskClass = textTaskClassSchema.safeParse(sourceJob.task_class);

    if (!parsedMessages.success || !parsedProfile.success || !parsedTaskClass.success) {
      return NextResponse.json(
        { error: "The failed local job does not contain valid escalation evidence." },
        { status: 409 },
      );
    }

    const paidMessages = paidHandoffMessages(
      parsedMessages.data,
      typeof sourceJob.paid_prompt_draft === "string"
        ? sourceJob.paid_prompt_draft
        : null,
    );

    const profileBalance = await aiProfileBalanceForUser(userId);
    if (!profileBalance.funded) {
      return NextResponse.json(
        {
          error:
            "A funded profile AI balance is required before high-quality paid AI can be used.",
          profileBalance: {
            availableMicrousd: profileBalance.availableMicrousd,
            availableUsd: profileBalance.availableUsd,
            funded: false,
          },
        },
        { status: 409 },
      );
    }

    const requestSpendCapUsd =
      typeof sourceJob.request_max_spend_microusd === "number"
        ? sourceJob.request_max_spend_microusd / 1_000_000
        : null;
    const effectivePaidBudgetUsd =
      requestSpendCapUsd === null
        ? profileBalance.availableUsd
        : Math.min(profileBalance.availableUsd, requestSpendCapUsd);

    if (effectivePaidBudgetUsd <= 0) {
      return NextResponse.json(
        {
          error: "This request's Model Mixer spend cap does not allow paid AI usage.",
          requestSpendCapUsd,
        },
        { status: 409 },
      );
    }

    const evidence: EscalationEvidence = {
      taskClass: parsedTaskClass.data,
      localProfile: parsedProfile.data,
      messages: paidMessages,
      requestedOutputTokens:
        typeof sourceJob.max_tokens === "number"
          ? Math.max(16, Math.min(4096, sourceJob.max_tokens))
          : 768,
      localAttempts: 1,
      localFailures: 1,
      localExecutionUnavailable: true,
      verificationStatus: "inconclusive",
      allowPaidFallback: true,
      automaticPaidBudgetUsd: effectivePaidBudgetUsd,
      fundedPaidBalanceUsd: profileBalance.availableUsd,
      requiredSuccessRate: 0.8,
    };

    const candidate = configuredOpenAiCandidate(evidence);
    const decision = evaluatePaidEscalation(
      evidence,
      candidate ? [candidate] : [],
    );

    if (
      decision.action !== "escalate" ||
      !decision.candidate ||
      decision.candidate.provider !== "openai"
    ) {
      return NextResponse.json(
        {
          error:
            "No configured funded high-quality executor currently satisfies this failed local request.",
          decision,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const estimatedCostUsd = decision.candidate.estimatedMarginalCostUsd;
    if (
      typeof estimatedCostUsd !== "number" ||
      !Number.isFinite(estimatedCostUsd) ||
      estimatedCostUsd <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "The high-quality executor does not have a known configured request cost.",
          decision,
        },
        { status: 409 },
      );
    }

    if (
      requestSpendCapUsd !== null &&
      estimatedCostUsd > requestSpendCapUsd
    ) {
      return NextResponse.json(
        {
          error: "The selected paid model would exceed this request's Model Mixer spend cap.",
          requestSpendCapUsd,
          estimatedCostUsd,
        },
        { status: 409 },
      );
    }

    const paidJobId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const { error: insertError } = await admin.from("text_inference_jobs").insert({
      id: paidJobId,
      status: "running",
      client_owner_ref: ownerRef,
      conversation_id: sourceJob.conversation_id,
      messages: parsedMessages.data,
      profile: "quality",
      max_tokens: evidence.requestedOutputTokens,
      temperature:
        typeof sourceJob.temperature === "number" ? sourceJob.temperature : 0.2,
      routing_mode: "auto",
      task_class: parsedTaskClass.data,
      route_reason:
        typeof sourceJob.paid_prompt_draft === "string" &&
        sourceJob.paid_prompt_draft.trim()
          ? "Lower-cost local/free reasoning prepared an advisory escalation handoff; deterministic funded paid-AI escalation then selected a qualified executor within the saved cap."
          : "Hard local execution failure triggered deterministic funded paid-AI escalation.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      model_mixer: sourceJob.model_mixer || null,
      request_max_spend_microusd: sourceJob.request_max_spend_microusd ?? null,
      context_document_path: sourceJob.context_document_path || null,
      context_document_generated_at: sourceJob.context_document_generated_at || null,
      capability: "text",
      routing_preference: "default",
      fallback_for_job_id: sourceJob.id,
      worker_id: "cooperative-paid-router",
      claimed_at: startedAt,
    });

    if (insertError) {
      // A unique fallback_for_job_id means a concurrent retry already won.
      const { data: concurrent } = await admin
        .from("text_inference_jobs")
        .select("id,status,conversation_id")
        .eq("fallback_for_job_id", sourceJob.id)
        .eq("client_owner_ref", ownerRef)
        .maybeSingle();

      if (concurrent) {
        return NextResponse.json(
          {
            jobId: concurrent.id,
            status: concurrent.status,
            conversationId: concurrent.conversation_id,
            execution: "paid-ai",
            reused: true,
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw insertError;
    }

    const reservation = await reserveAiProfileFunds({
      profileRef: cooperativeProfileRef(userId),
      estimatedCostUsd,
      source: "local-chat-paid-fallback",
      referenceId: paidJobId,
      metadata: {
        sourceJobId: sourceJob.id,
        conversationId: sourceJob.conversation_id,
        provider: decision.candidate.provider,
        handoffPrepared: Boolean(
          typeof sourceJob.paid_prompt_draft === "string" &&
            sourceJob.paid_prompt_draft.trim(),
        ),
        model: decision.candidate.model,
        requestSpendCapUsd,
      },
    });

    if (!reservation) {
      await admin
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error:
            "Profile AI balance was no longer sufficient when the paid request attempted to reserve funds.",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", paidJobId);

      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef,
          jobId: paidJobId,
          conversationId: sourceJob.conversation_id,
          requestType: "text / paid reservation failure",
          allowExternalReview: true,
        });
      } catch (contextError) {
        console.error("Could not archive paid reservation failure", {
          jobId: paidJobId,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }

      return NextResponse.json(
        {
          error:
            "The profile AI balance no longer has enough available funds for this high-quality request.",
        },
        { status: 409 },
      );
    }

    const started = Date.now();
    let result;
    try {
      result = await executeOpenAiPaidText(evidence, {
        model: decision.candidate.model,
      });
    } catch (executionError) {
      await releaseAiProfileFunds({
        reservationId: reservation.id,
        metadata: {
          reason: "paid-ai-execution-failed",
          sourceJobId: sourceJob.id,
          paidJobId,
        },
      });

      const detail =
        executionError instanceof Error
          ? executionError.message
          : "Paid AI execution failed.";
      const completedAt = new Date().toISOString();
      await admin
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error: detail.slice(0, 1200),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", paidJobId);

      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef,
          jobId: paidJobId,
          conversationId: sourceJob.conversation_id,
          requestType: "text / paid execution failure",
          allowExternalReview: true,
        });
      } catch (contextError) {
        console.error("Could not archive paid execution failure", {
          jobId: paidJobId,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }

      throw executionError;
    }

    if (
      typeof result.estimatedCostUsd !== "number" ||
      !Number.isFinite(result.estimatedCostUsd) ||
      result.estimatedCostUsd < 0
    ) {
      await releaseAiProfileFunds({
        reservationId: reservation.id,
        metadata: {
          reason: "paid-ai-cost-unavailable",
          sourceJobId: sourceJob.id,
          paidJobId,
        },
      });

      const completedAt = new Date().toISOString();
      await admin
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error:
            "Paid AI returned usage without a measurable configured cost; output was quarantined.",
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", paidJobId);

      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef,
          jobId: paidJobId,
          conversationId: sourceJob.conversation_id,
          requestType: "text / paid cost verification failure",
          allowExternalReview: true,
        });
      } catch (contextError) {
        console.error("Could not archive paid cost failure", {
          jobId: paidJobId,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }

      return NextResponse.json(
        {
          error:
            "Paid AI returned usage without a measurable configured cost; output was quarantined.",
        },
        { status: 409 },
      );
    }

    const availableMicrousd = await settleAiProfileFunds({
      reservationId: reservation.id,
      actualCostUsd: result.estimatedCostUsd,
      metadata: {
        sourceJobId: sourceJob.id,
        paidJobId,
        provider: result.provider,
        model: result.model,
        responseId: result.responseId,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        requestSpendCapUsd,
      },
    });

    const completedAt = new Date().toISOString();
    const latencyMs = Date.now() - started;
    const { error: completeError } = await admin
      .from("text_inference_jobs")
      .update({
        status: "completed",
        partial_text: result.text,
        result_text: result.text,
        result_model: result.model,
        result_provider: result.provider,
        prompt_tokens: result.promptTokens ?? null,
        output_tokens: result.outputTokens ?? null,
        latency_ms: latencyMs,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", paidJobId);

    if (completeError) throw completeError;

    const { error: messageError } = await admin.from("local_ai_messages").upsert(
      {
        conversation_id: sourceJob.conversation_id,
        owner_ref: ownerRef,
        role: "assistant",
        content: result.text,
        job_id: paidJobId,
      },
      { onConflict: "job_id,role" },
    );
    if (messageError) throw messageError;

    const { error: conversationError } = await admin
      .from("local_ai_conversations")
      .update({ updated_at: completedAt })
      .eq("id", sourceJob.conversation_id)
      .eq("owner_ref", ownerRef);
    if (conversationError) throw conversationError;

    try {
      await refreshRuntimeContextAfterOutcome({
        ownerRef,
        jobId: paidJobId,
        conversationId: sourceJob.conversation_id,
        requestType: "text / paid success",
        allowExternalReview: true,
      });
    } catch (contextError) {
      console.error("Could not refresh paid runtime context", {
        jobId: paidJobId,
        detail:
          contextError instanceof Error
            ? contextError.message.slice(0, 600)
            : "Unknown context error",
      });
    }

    return NextResponse.json(
      {
        jobId: paidJobId,
        status: "completed",
        conversationId: sourceJob.conversation_id,
        text: result.text,
        model: result.model,
        provider: result.provider,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        latencyMs,
        execution: "paid-ai",
        routeReason:
          typeof sourceJob.paid_prompt_draft === "string" &&
          sourceJob.paid_prompt_draft.trim()
            ? "Local/free reasoning prepared the stronger-model handoff; a profile-funded qualified model completed the request within the saved spend policy."
            : "Local execution failed; profile-funded high-quality AI completed the request.",
        funding: {
          reservationId: reservation.id,
          chargedUsd: result.estimatedCostUsd,
          availableMicrousd,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not run funded paid fallback.";
    return NextResponse.json(
      {
        error: "Could not run funded paid fallback.",
        detail: detail.slice(0, 1200),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
