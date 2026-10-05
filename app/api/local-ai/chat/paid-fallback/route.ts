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
import { paidFundingRequirement } from "@/lib/runtime/profile-execution-router";
import { paidHandoffMessages, persistResponseSupport } from "@/lib/ai/response-support";
import { refreshRuntimeContextAfterOutcome } from "@/lib/ai/runtime-context-markdown";
import {
  aiProfileBalanceForUser,
  cooperativeProfileRef,
  microusdToUsd,
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
        "id,status,client_owner_ref,conversation_id,business_id,messages,profile,max_tokens,temperature,task_class,allow_paid_fallback,capability,error,model_mixer,request_max_spend_microusd,paid_prompt_draft,paid_prompt_reason,support_packet,context_document_path,context_document_generated_at",
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

    const requestSpendCapUsd =
      typeof sourceJob.request_max_spend_microusd === "number"
        ? sourceJob.request_max_spend_microusd / 1_000_000
        : null;
    if (requestSpendCapUsd !== null && requestSpendCapUsd <= 0) {
      return NextResponse.json(
        {
          error: "This request's Model Mixer spend cap does not allow paid AI usage.",
          requestSpendCapUsd,
        },
        { status: 409 },
      );
    }

    const effectivePaidBudgetUsd =
      requestSpendCapUsd === null
        ? Math.max(profileBalance.availableUsd, 100)
        : requestSpendCapUsd;

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

    if (!decision.candidate || decision.candidate.provider !== "openai") {
      return NextResponse.json(
        {
          error:
            "No configured high-quality executor currently satisfies this failed local request.",
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
          suggestedMinimumCapUsd: estimatedCostUsd,
        },
        { status: 409 },
      );
    }

    const fundingRequirement = paidFundingRequirement({
      estimatedCostUsd,
      availableBalanceUsd: profileBalance.availableUsd,
      maxSpendUsd: requestSpendCapUsd,
    });

    if (!fundingRequirement.sufficientBalance) {
      const { data: topUpOptions, error: topUpOptionsError } = await admin
        .from("ai_balance_topup_options")
        .select("id,label,amount_microusd,currency")
        .eq("active", true)
        .eq("livemode", true)
        .order("amount_microusd", { ascending: true });
      if (topUpOptionsError) throw topUpOptionsError;

      const options = (topUpOptions || []).map((option) => ({
        id: String(option.id),
        label: String(option.label || "Add balance"),
        amountMicrousd: Number(option.amount_microusd || 0),
        amountUsd: microusdToUsd(Number(option.amount_microusd || 0)),
        currency: String(option.currency || "usd"),
      }));
      const minimumCoveringOption =
        options.find(
          (option) =>
            option.amountUsd + profileBalance.availableUsd >=
            fundingRequirement.minimumRequiredBalanceUsd,
        ) ||
        options[options.length - 1] ||
        null;

      const directive = [
        `AI_FUNDING_REQUIRED:${sourceJob.id}`,
        `ESTIMATED_USD:${estimatedCostUsd.toFixed(6)}`,
        `AVAILABLE_USD:${profileBalance.availableUsd.toFixed(6)}`,
        `SHORTFALL_USD:${fundingRequirement.shortfallUsd.toFixed(6)}`,
        minimumCoveringOption
          ? `TOPUP_OPTION:${minimumCoveringOption.id}`
          : "TOPUP_OPTION:none",
        minimumCoveringOption
          ? `TOPUP_USD:${minimumCoveringOption.amountUsd.toFixed(6)}`
          : "TOPUP_USD:0",
      ].join("\n");

      const assistantText = [
        `The free/local routes could not complete this request. A qualified paid model is available and is estimated to cost about ${estimatedCostUsd.toFixed(4)}.`,
        `Your available CoOperative AI balance is ${profileBalance.availableUsd.toFixed(4)}, so you need at least ${fundingRequirement.shortfallUsd.toFixed(4)} more before I can use it.`,
        minimumCoveringOption
          ? `The smallest configured Stripe top-up that covers this request is ${minimumCoveringOption.amountUsd.toFixed(2)}.`
          : "No Stripe balance top-up option is currently configured.",
        "I did not spend anything.",
        "",
        directive,
      ].join("\n");

      await admin.from("local_ai_messages").upsert(
        {
          conversation_id: sourceJob.conversation_id,
          owner_ref: ownerRef,
          role: "assistant",
          content: assistantText,
          job_id: sourceJob.id,
        },
        { onConflict: "job_id,role" },
      );

      return NextResponse.json(
        {
          status: "funding-required",
          execution: "code",
          conversationId: sourceJob.conversation_id,
          sourceJobId: sourceJob.id,
          error: "Additional funded AI balance is required for this paid route.",
          fundingRequired: {
            estimatedCostUsd,
            availableBalanceUsd: profileBalance.availableUsd,
            shortfallUsd: fundingRequirement.shortfallUsd,
            minimumRequiredBalanceUsd:
              fundingRequirement.minimumRequiredBalanceUsd,
            topUpOption: minimumCoveringOption,
          },
          decision,
        },
        { status: 402, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (decision.action !== "escalate") {
      return NextResponse.json(
        {
          error:
            "The stronger model is qualified, but current request policy does not authorize this paid execution.",
          decision,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
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
      business_id: sourceJob.business_id || null,
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
          businessId: sourceJob.business_id || null,
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

      const latestBalance = await aiProfileBalanceForUser(userId);
      const raceFunding = paidFundingRequirement({
        estimatedCostUsd,
        availableBalanceUsd: latestBalance.availableUsd,
        maxSpendUsd: requestSpendCapUsd,
      });
      return NextResponse.json(
        {
          error:
            "The profile AI balance changed before funds could be reserved.",
          status: "funding-required",
          sourceJobId: sourceJob.id,
          fundingRequired: {
            estimatedCostUsd,
            availableBalanceUsd: latestBalance.availableUsd,
            shortfallUsd: raceFunding.shortfallUsd,
            minimumRequiredBalanceUsd: raceFunding.minimumRequiredBalanceUsd,
          },
        },
        { status: 402 },
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
          businessId: sourceJob.business_id || null,
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
          businessId: sourceJob.business_id || null,
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
      await persistResponseSupport({
        ownerRef,
        conversationId: sourceJob.conversation_id,
        jobId: paidJobId,
        messages: parsedMessages.data,
        answer: result.text,
        provider: result.provider,
        model: result.model,
        businessId: sourceJob.business_id || null,
      });
    } catch (supportError) {
      console.error("Could not persist premium response support", {
        jobId: paidJobId,
        detail:
          supportError instanceof Error
            ? supportError.message.slice(0, 600)
            : "Unknown support error",
      });
    }

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
