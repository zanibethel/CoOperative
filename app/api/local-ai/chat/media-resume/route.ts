import { NextResponse } from "next/server";
import { z } from "zod";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import {
  cooperativeProfileRef,
  releaseAiProfileFunds,
  reserveAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";
import { fundingQuoteForUser } from "@/lib/billing/ai-funding-handoff";
import { startHermesMediaTask } from "@/lib/inference/hermes-media-cloud";
import { openRouterKeySpendStatus } from "@/lib/inference/openrouter-media-catalog";
import { adultMediaContentClass } from "@/lib/inference/media-request";
import { evaluateMediaExecutionContentGate } from "@/lib/inference/media-model-capabilities";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();

  try {
    const { data: job, error: jobError } = await admin
      .from("media_generation_jobs")
      .select(
        "id,status,conversation_id,kind,prompt,provider,model,request_max_spend_microusd,estimated_provider_cost_microusd,estimated_user_charge_microusd,ai_balance_reservation_id,billing_mode,pricing_dimensions",
      )
      .eq("id", input.jobId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) {
      return NextResponse.json({ error: "Media job not found." }, { status: 404 });
    }

    if (job.status === "running" || job.status === "completed") {
      return NextResponse.json(
        {
          jobId: job.id,
          status: job.status,
          execution: "media",
          conversationId: job.conversation_id,
          capability: job.kind,
          provider: job.provider,
          model: job.model,
        },
        {
          status: job.status === "running" ? 202 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (job.status !== "queued") {
      return NextResponse.json(
        {
          error: "This media request is no longer resumable.",
          status: job.status,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      job.billing_mode !== "cooperative-balance" ||
      job.provider !== "openrouter"
    ) {
      return NextResponse.json(
        {
          error:
            "This media job is not a CoOperative-balance paid media request.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const estimatedCostUsd =
      Math.max(0, Number(job.estimated_user_charge_microusd || 0)) / 1_000_000;
    const maxSpendUsd =
      job.request_max_spend_microusd === null
        ? null
        : Math.max(0, Number(job.request_max_spend_microusd || 0)) / 1_000_000;

    if (estimatedCostUsd <= 0) {
      return NextResponse.json(
        { error: "This media job has no valid paid cost estimate." },
        { status: 409 },
      );
    }

    const quote = await fundingQuoteForUser({
      userId,
      estimatedCostUsd,
      maxSpendUsd,
    });

    if (!quote.allowedBySpendPolicy) {
      return NextResponse.json(
        {
          error: "This paid media job exceeds the request spend cap.",
          fundingRequired: quote,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!quote.sufficientBalance) {
      return NextResponse.json(
        {
          error: "Additional CoOperative AI balance is required.",
          status: "funding-required",
          jobId: job.id,
          conversationId: job.conversation_id,
          fundingRequired: quote,
        },
        { status: 402, headers: { "Cache-Control": "no-store" } },
      );
    }

    const providerCredential = process.env.OPENROUTER_API_KEY?.trim();
    if (!providerCredential) {
      return NextResponse.json(
        {
          error:
            "CoOperative-managed OpenRouter media is temporarily unavailable.",
        },
        { status: 503 },
      );
    }

    const spendStatus = await openRouterKeySpendStatus(providerCredential);
    const providerEstimateUsd =
      Math.max(0, Number(job.estimated_provider_cost_microusd || 0)) / 1_000_000;
    const enoughKnownBalance =
      spendStatus.accountCreditsRemainingUsd === null ||
      spendStatus.accountCreditsRemainingUsd >= providerEstimateUsd;
    const enoughKeyLimit =
      spendStatus.keyLimitRemainingUsd === null ||
      spendStatus.keyLimitRemainingUsd >= providerEstimateUsd;
    if (!spendStatus.paidEligible || !enoughKnownBalance || !enoughKeyLimit) {
      return NextResponse.json(
        {
          error:
            "CoOperative's paid media provider does not currently have enough live spend capacity for this request.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentGate = await evaluateMediaExecutionContentGate({
      userId,
      ownerRef,
      provider: "openrouter",
      model: job.model,
      adultContentClass: adultMediaContentClass(job.prompt),
    });
    if (!contentGate.allowed) {
      return NextResponse.json(
        {
          error: contentGate.note,
          reason: contentGate.reason,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    let reservationId = job.ai_balance_reservation_id as string | null;
    if (!reservationId) {
      const reservation = await reserveAiProfileFunds({
        profileRef: cooperativeProfileRef(userId),
        estimatedCostUsd,
        source: "media-generation",
        referenceId: job.id,
        metadata: {
          provider: job.provider,
          model: job.model,
          kind: job.kind,
          conversationId: job.conversation_id,
          resumedAfterFunding: true,
        },
      });

      if (!reservation) {
        const refreshedQuote = await fundingQuoteForUser({
          userId,
          estimatedCostUsd,
          maxSpendUsd,
        });
        return NextResponse.json(
          {
            error: "The available AI balance changed before funds could be reserved.",
            status: "funding-required",
            jobId: job.id,
            conversationId: job.conversation_id,
            fundingRequired: refreshedQuote,
          },
          { status: 402, headers: { "Cache-Control": "no-store" } },
        );
      }

      const { data: linked, error: linkError } = await admin
        .from("media_generation_jobs")
        .update({
          ai_balance_reservation_id: reservation.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("owner_ref", ownerRef)
        .eq("status", "queued")
        .is("ai_balance_reservation_id", null)
        .select("id")
        .maybeSingle();
      if (linkError) {
        await releaseAiProfileFunds({
          reservationId: reservation.id,
          metadata: { reason: "media-resume-link-error", jobId: job.id },
        }).catch(() => undefined);
        throw linkError;
      }

      if (!linked) {
        await releaseAiProfileFunds({
          reservationId: reservation.id,
          metadata: { reason: "media-resume-race-lost", jobId: job.id },
        }).catch(() => undefined);
        const { data: latest } = await admin
          .from("media_generation_jobs")
          .select("status,ai_balance_reservation_id")
          .eq("id", job.id)
          .eq("owner_ref", ownerRef)
          .maybeSingle();
        if (latest?.status === "running") {
          return NextResponse.json(
            {
              jobId: job.id,
              status: "running",
              execution: "media",
              conversationId: job.conversation_id,
              capability: job.kind,
              provider: job.provider,
              model: job.model,
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        }
        return NextResponse.json(
          { error: "This media request changed while it was being resumed." },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }

      reservationId = reservation.id;
    }

    try {
      const started = await startHermesMediaTask({
        jobId: job.id,
        kind: job.kind,
        userRequest: job.prompt,
        provider: "openrouter",
        model: job.model,
        providerCredential,
        orchestratorProvider: "openrouter",
        orchestratorModel: "openrouter/free",
      });

      const { data: claimed, error: startError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "running",
          sandbox_name: started.sandboxName,
          started_at: started.startedAt,
          deadline_at: started.deadlineAt,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("owner_ref", ownerRef)
        .eq("status", "queued")
        .eq("ai_balance_reservation_id", reservationId)
        .select("id")
        .maybeSingle();
      if (startError) throw startError;
      if (!claimed) {
        throw new Error("Media job could not be claimed after funding.");
      }

      return NextResponse.json(
        {
          jobId: job.id,
          status: "running",
          execution: "media",
          conversationId: job.conversation_id,
          capability: job.kind,
          provider: started.provider,
          model: started.model,
          estimatedProviderCostUsd: providerEstimateUsd,
          routeReason:
            "CoOperative confirmed the Stripe-funded profile balance, reserved the bounded request amount, and resumed the original paid media job without creating a duplicate generation.",
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (reservationId) {
        await releaseAiProfileFunds({
          reservationId,
          metadata: {
            reason: "funded-media-resume-did-not-start",
            jobId: job.id,
          },
        }).catch(() => undefined);
      }
      const detail =
        error instanceof Error ? error.message : "Paid media could not start.";
      await admin
        .from("media_generation_jobs")
        .update({
          status: "failed",
          ai_balance_reservation_id: null,
          billed_microusd: 0,
          actual_user_charge_microusd: 0,
          error: detail.slice(0, 1200),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("owner_ref", ownerRef)
        .eq("status", "queued");

      return NextResponse.json(
        { error: detail, jobId: job.id, status: "failed" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not resume paid media.";
    return NextResponse.json(
      { error: "Could not resume paid media.", detail: detail.slice(0, 1000) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
