import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { evaluateAgentTaskEscalation } from "@/lib/inference/agent-escalation";
import { aiProfileBalanceForOwnerRef } from "@/lib/billing/ai-profile-balance";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  userId: z.string().min(1).max(200),
  creatorId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: z.enum(["evaluate", "retry-stronger"]),
  approvedMaxCostUsd: z.number().min(0).max(100).optional(),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function ownerRef(userId: string, creatorId: string) {
  return `creatorhub:${userId}:${creatorId}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const owner = ownerRef(input.userId, input.creatorId);
    const admin = createAdminSupabaseClient();

    const { data: task, error } = await admin
      .from("agent_tasks")
      .select(
        "id,owner_ref,status,objective,agent_key,repo_key,mode,requested_profile,error,result",
      )
      .eq("id", input.taskId)
      .eq("owner_ref", owner)
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      return NextResponse.json({ error: "Agent task not found." }, { status: 404 });
    }
    if (task.status !== "failed") {
      return NextResponse.json(
        { error: `Only failed tasks can be escalated (status: ${task.status}).` },
        { status: 409 },
      );
    }

    const profileBalance = await aiProfileBalanceForOwnerRef(owner);
    const recommendation = await evaluateAgentTaskEscalation(admin, task, {
      allowPaidFallback: profileBalance?.funded === true,
      automaticPaidBudgetUsd: profileBalance?.availableUsd ?? 0,
      fundedPaidBalanceUsd: profileBalance?.availableUsd ?? 0,
      requiredSuccessRate: 0.8,
    });

    if (input.action === "evaluate") {
      return NextResponse.json(
        {
          recommendation,
          profileBalance: {
            availableMicrousd: profileBalance?.availableMicrousd ?? 0,
            availableUsd: profileBalance?.availableUsd ?? 0,
            funded: profileBalance?.funded === true,
            paidAiEligible: profileBalance?.funded === true,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const decision = recommendation.decision;
    if (!decision.justified || !decision.candidate) {
      return NextResponse.json(
        {
          error: "No qualified stronger executor is currently available for this failed task.",
          recommendation,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const estimatedCostUsd = decision.candidate.estimatedMarginalCostUsd;
    if (
      typeof estimatedCostUsd !== "number" ||
      !Number.isFinite(estimatedCostUsd)
    ) {
      return NextResponse.json(
        {
          error:
            "The stronger executor cost is unknown, so CoOperative will not create a paid retry.",
          recommendation,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!profileBalance?.funded || profileBalance.availableUsd + 1e-9 < estimatedCostUsd) {
      return NextResponse.json(
        {
          error:
            "A funded profile AI balance is required and must cover the estimated stronger-model cost.",
          recommendation,
          profileBalance: {
            availableMicrousd: profileBalance?.availableMicrousd ?? 0,
            availableUsd: profileBalance?.availableUsd ?? 0,
            funded: profileBalance?.funded === true,
          },
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const approvedMaxCostUsd =
      typeof input.approvedMaxCostUsd === "number"
        ? Math.min(input.approvedMaxCostUsd, profileBalance?.availableUsd ?? 0)
        : profileBalance?.availableUsd ?? 0;

    if (approvedMaxCostUsd + 1e-9 < estimatedCostUsd) {
      return NextResponse.json(
        {
          error:
            "The requested paid-AI ceiling does not cover the currently estimated cost.",
          recommendation,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const retryTaskId = crypto.randomUUID();
    const approvedAt = new Date().toISOString();
    const executorApproval = {
      sourceTaskId: task.id,
      provider: decision.candidate.provider,
      model: decision.candidate.model,
      candidateId: decision.candidate.id,
      approvedAt,
      approvedMaxCostUsd,
      estimatedCostUsd,
      approvalSource: "creatorhub-funded-profile",
      profileAvailableUsdAtApproval: profileBalance?.availableUsd ?? 0,
    };

    const { error: insertError } = await admin.from("agent_tasks").insert({
      id: retryTaskId,
      owner_ref: owner,
      agent_key: task.agent_key,
      repo_key: task.repo_key,
      mode: task.mode,
      objective: task.objective,
      requested_profile: task.requested_profile,
      status: "queued",
      result: {
        executorApproval,
        escalatedFromTaskId: task.id,
      },
    });
    if (insertError) throw insertError;

    await admin.from("agent_task_events").insert({
      task_id: retryTaskId,
      owner_ref: owner,
      kind: "paid_escalation_approved",
      message:
        "Owner approved a stronger executor retry funded from the profile AI balance after deterministic escalation evaluation.",
      metadata: {
        sourceTaskId: task.id,
        provider: decision.candidate.provider,
        model: decision.candidate.model,
        estimatedCostUsd,
        approvedMaxCostUsd,
        reasonCodes: decision.reasonCodes,
      },
    });

    return NextResponse.json(
      {
        taskId: retryTaskId,
        status: "queued",
        recommendation,
        executorApproval,
        text: `Stronger-model retry queued with an approved maximum cost of $${approvedMaxCostUsd.toFixed(
          4,
        )}. It still must pass the same scope guard, checks, and human code approval before any push or deploy.`,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not handle agent escalation.";

    return NextResponse.json(
      { error: "Could not handle agent escalation.", detail: detail.slice(0, 1000) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
