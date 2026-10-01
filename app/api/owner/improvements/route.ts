import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  collectOwnerImprovementEvidence,
  ownerImprovementReportPrompt,
} from "@/lib/ai/owner-improvement-evidence";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import { preferredOwnedTextNode } from "@/lib/unison/owned-text-routing";

export const runtime = "nodejs";
export const maxDuration = 30;

const OWNER_IMPROVEMENT_ROUTE_REASON =
  "Owner Improvement Report compiled from aggregate internal telemetry. Owned/local Quality model only; paid fallback disabled.";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate_report") }),
  z.object({
    action: z.literal("tell_more"),
    reportJobId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("review"),
    reportJobId: z.string().uuid(),
    decision: z.enum(["approved", "denied", "deferred"]),
  }),
  z.object({
    action: z.literal("prepare_change"),
    reportJobId: z.string().uuid(),
  }),
]);

function reviewObjective(reportJobId: string) {
  return `Owner improvement review for report ${reportJobId}`;
}

async function getReportJob(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ownerRef: string,
  reportJobId: string,
) {
  const { data, error } = await admin
    .from("text_inference_jobs")
    .select("id,status,result_text,route_reason,created_at,completed_at")
    .eq("id", reportJobId)
    .eq("client_owner_ref", ownerRef)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.route_reason !== OWNER_IMPROVEMENT_ROUTE_REASON) return null;
  return data;
}

async function ensureReviewTask(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ownerRef: string,
  reportJobId: string,
) {
  const objective = reviewObjective(reportJobId);
  const { data: existing, error: readError } = await admin
    .from("agent_tasks")
    .select("id,status,result,created_at,updated_at,completed_at")
    .eq("owner_ref", ownerRef)
    .eq("objective", objective)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const taskId = crypto.randomUUID();
  const { data: created, error: createError } = await admin
    .from("agent_tasks")
    .insert({
      id: taskId,
      owner_ref: ownerRef,
      agent_key: "project-memory",
      repo_key: "cooperative",
      mode: "inspect",
      objective,
      requested_profile: "fast",
      status: "needs_approval",
      result: {
        kind: "owner_improvement_review",
        reportJobId,
        decision: "pending",
      },
    })
    .select("id,status,result,created_at,updated_at,completed_at")
    .single();

  if (createError) throw createError;

  await admin.from("agent_task_events").insert({
    task_id: taskId,
    owner_ref: ownerRef,
    kind: "review_created",
    message: "Owner Improvement Report is ready for review.",
    metadata: { reportJobId },
  });

  return created;
}

async function latestReview(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  ownerRef: string,
  reportJobId: string,
) {
  const { data, error } = await admin
    .from("agent_tasks")
    .select("id,status,result,created_at,updated_at,completed_at")
    .eq("owner_ref", ownerRef)
    .eq("objective", reviewObjective(reportJobId))
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function ownerContext() {
  const userId = await authenticatedUserId();
  if (!userId) return null;

  const admin = createAdminSupabaseClient();
  const { data: owner, error } = await admin
    .from("unison_platform_owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!owner) return null;

  return {
    userId,
    ownerRef: `coop-user:${userId}`,
  };
}

export async function POST(request: Request) {
  try {
    const owner = await ownerContext();
    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const input = requestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    if (input.action !== "generate_report") {
      const report = await getReportJob(
        admin,
        owner.ownerRef,
        input.reportJobId,
      );

      if (!report || report.status !== "completed" || !report.result_text) {
        return NextResponse.json(
          { error: "Completed improvement report not found." },
          { status: 404 },
        );
      }

      const review = await ensureReviewTask(
        admin,
        owner.ownerRef,
        input.reportJobId,
      );

      if (input.action === "tell_more") {
        const evidence = await collectOwnerImprovementEvidence(owner.userId);
        const ownedNode = await preferredOwnedTextNode(admin, owner.userId);
        const followUpJobId = crypto.randomUUID();
        const { error: followUpError } = await admin
          .from("text_inference_jobs")
          .insert({
            id: followUpJobId,
            status: "queued",
            client_owner_ref: owner.ownerRef,
            messages: [
              {
                role: "system",
                content:
                  "You are CoOperative Improvement Lab. Explain the existing report in more detail using only the report and current aggregate evidence. Do not invent facts. Do not propose autonomous deployment or spend.",
              },
              {
                role: "user",
                content: [
                  "OWNER REQUEST: Tell me more about this improvement report.",
                  "",
                  "REPORT:",
                  report.result_text,
                  "",
                  "CURRENT AGGREGATE EVIDENCE:",
                  JSON.stringify(evidence, null, 2),
                  "",
                  "Clarify the strongest findings, evidence, tradeoffs, and which next action would be safest to prepare first.",
                ].join("\n"),
              },
            ],
            profile: "quality",
            max_tokens: 1400,
            temperature: 0.1,
            routing_mode: "local-quality",
            task_class: "reasoning",
            route_reason: `Owner Improvement Report follow-up for ${input.reportJobId}. Owned/local Quality only; paid fallback disabled.`,
            allow_paid_fallback: false,
            human_approval_required: false,
            model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
            verification_status: "not_run",
            routing_preference: ownedNode ? "prefer-owned" : "default",
            preferred_node_id: ownedNode?.id ?? null,
          });

        if (followUpError) throw followUpError;

        await admin.from("agent_task_events").insert({
          task_id: review.id,
          owner_ref: owner.ownerRef,
          kind: "owner_requested_detail",
          message: "Owner requested more detail on the Improvement Report.",
          metadata: {
            reportJobId: input.reportJobId,
            followUpJobId,
            ownedNodePreferred: Boolean(ownedNode),
            preferredNodeId: ownedNode?.id ?? null,
          },
        });

        return NextResponse.json(
          { jobId: followUpJobId, status: "queued", review },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (input.action === "review") {
        const now = new Date().toISOString();
        const result = {
          ...(review.result && typeof review.result === "object"
            ? review.result
            : {}),
          kind: "owner_improvement_review",
          reportJobId: input.reportJobId,
          decision: input.decision,
          decidedAt: now,
        };
        const terminal = input.decision === "approved" || input.decision === "denied";

        const { data: updated, error: updateError } = await admin
          .from("agent_tasks")
          .update({
            status:
              input.decision === "approved"
                ? "completed"
                : input.decision === "denied"
                  ? "cancelled"
                  : "needs_approval",
            result,
            completed_at: terminal ? now : null,
            updated_at: now,
          })
          .eq("id", review.id)
          .eq("owner_ref", owner.ownerRef)
          .select("id,status,result,created_at,updated_at,completed_at")
          .single();

        if (updateError) throw updateError;

        await admin.from("agent_task_events").insert({
          task_id: review.id,
          owner_ref: owner.ownerRef,
          kind: `owner_${input.decision}`,
          message: `Owner marked the Improvement Report as ${input.decision}.`,
          metadata: { reportJobId: input.reportJobId },
        });

        return NextResponse.json(
          { review: updated },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const decision =
        review.result && typeof review.result === "object"
          ? (review.result as { decision?: unknown }).decision
          : null;

      if (decision !== "approved") {
        return NextResponse.json(
          { error: "Approve this report before preparing code changes." },
          { status: 409 },
        );
      }

      const resultObject =
        review.result && typeof review.result === "object"
          ? (review.result as Record<string, unknown>)
          : {};
      const existingPreparedTaskId =
        typeof resultObject.preparedTaskId === "string"
          ? resultObject.preparedTaskId
          : null;

      if (existingPreparedTaskId) {
        return NextResponse.json(
          { taskId: existingPreparedTaskId, status: "already_prepared", review },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const taskId = crypto.randomUUID();
      const objective = [
        "Prepare a bounded CoOperative code/playbook improvement from the owner-approved Improvement Report below.",
        "Inspect current repository state and current evidence before changing anything.",
        "Choose the smallest safe, high-leverage change justified by the report.",
        "Use deterministic code/playbooks before adding more model reasoning when practical.",
        "Do not push, merge, deploy, change secrets/billing/access, run destructive migrations, or promote/retrain models.",
        "Prepare the change in an isolated worktree/branch and return diff, tests, risks, and evidence for owner review.",
        "",
        "APPROVED IMPROVEMENT REPORT:",
        report.result_text,
      ].join("\n");

      const { error: taskError } = await admin.from("agent_tasks").insert({
        id: taskId,
        owner_ref: owner.ownerRef,
        agent_key: "repo-engineer",
        repo_key: "cooperative",
        mode: "prepare_change",
        objective,
        requested_profile: "quality",
        status: "queued",
      });

      if (taskError) throw taskError;

      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: owner.ownerRef,
        kind: "queued",
        message: "Owner-approved Improvement Report queued for bounded change preparation.",
        metadata: {
          source: "owner_improvement_report",
          reportJobId: input.reportJobId,
          reviewTaskId: review.id,
          profile: "quality",
        },
      });

      const now = new Date().toISOString();
      const { data: updatedReview, error: reviewUpdateError } = await admin
        .from("agent_tasks")
        .update({
          result: {
            ...resultObject,
            preparedTaskId: taskId,
            preparedAt: now,
          },
          updated_at: now,
        })
        .eq("id", review.id)
        .eq("owner_ref", owner.ownerRef)
        .select("id,status,result,created_at,updated_at,completed_at")
        .single();

      if (reviewUpdateError) throw reviewUpdateError;

      await admin.from("agent_task_events").insert({
        task_id: review.id,
        owner_ref: owner.ownerRef,
        kind: "prepare_change_queued",
        message: "Approved report handed to Repo Engineer for bounded change preparation.",
        metadata: {
          reportJobId: input.reportJobId,
          preparedTaskId: taskId,
        },
      });

      return NextResponse.json(
        { taskId, status: "queued", review: updatedReview },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    const evidence = await collectOwnerImprovementEvidence(owner.userId);
    const ownedNode = await preferredOwnedTextNode(admin, owner.userId);
    const jobId = crypto.randomUUID();

    const { error } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: owner.ownerRef,
      messages: [
        {
          role: "system",
          content:
            "You are an internal CoOperative platform-improvement analyst. Follow the supplied evidence and approval boundaries exactly.",
        },
        {
          role: "user",
          content: ownerImprovementReportPrompt(evidence),
        },
      ],
      profile: "quality",
      max_tokens: 1800,
      temperature: 0.1,
      routing_mode: "local-quality",
      task_class: "reasoning",
      route_reason: OWNER_IMPROVEMENT_ROUTE_REASON,
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      routing_preference: ownedNode ? "prefer-owned" : "default",
      preferred_node_id: ownedNode?.id ?? null,
    });

    if (error) throw error;

    const review = await ensureReviewTask(admin, owner.ownerRef, jobId);

    return NextResponse.json(
      {
        jobId,
        review,
        status: "queued",
        evidence,
        compiler: {
          route: "local-quality",
          paidFallback: false,
          modelRegistryRevision: TEXT_MODEL_REGISTRY_REVISION,
          ownedNodePreferred: Boolean(ownedNode),
          preferredNodeId: ownedNode?.id ?? null,
          preferredNodeName: ownedNode?.displayName ?? null,
        },
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not generate owner improvement report.";

    return NextResponse.json(
      {
        error: "Could not generate owner improvement report.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  try {
    const owner = await ownerContext();
    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId") || "";
    const admin = createAdminSupabaseClient();

    if (!jobId) {
      const evidence = await collectOwnerImprovementEvidence(owner.userId);
      const { data: latestReport, error: latestError } = await admin
        .from("text_inference_jobs")
        .select(
          "id,status,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,worker_id,routing_preference,preferred_node_id,error,route_reason,created_at,completed_at",
        )
        .eq("client_owner_ref", owner.ownerRef)
        .eq("route_reason", OWNER_IMPROVEMENT_ROUTE_REASON)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw latestError;

      const review = latestReport
        ? await latestReview(admin, owner.ownerRef, latestReport.id)
        : null;

      return NextResponse.json(
        {
          evidence,
          review,
          latestReport: latestReport
            ? {
                jobId: latestReport.id,
                status: latestReport.status,
                partialText: latestReport.partial_text,
                text: latestReport.result_text,
                model: latestReport.result_model,
                provider: latestReport.result_provider,
                promptTokens: latestReport.prompt_tokens,
                outputTokens: latestReport.output_tokens,
                firstTokenMs: latestReport.first_token_ms,
                latencyMs: latestReport.latency_ms,
                workerId: latestReport.worker_id,
                routingPreference: latestReport.routing_preference,
                preferredNodeId: latestReport.preferred_node_id,
                error: latestReport.error,
                createdAt: latestReport.created_at,
                completedAt: latestReport.completed_at,
              }
            : null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,worker_id,routing_preference,preferred_node_id,error,route_reason,created_at,completed_at",
      )
      .eq("id", jobId)
      .eq("client_owner_ref", owner.ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return NextResponse.json({ error: "Report job not found." }, { status: 404 });
    }

    const review =
      job.route_reason === OWNER_IMPROVEMENT_ROUTE_REASON
        ? await latestReview(admin, owner.ownerRef, job.id)
        : null;

    return NextResponse.json(
      {
        review,
        jobId: job.id,
        status: job.status,
        partialText: job.partial_text,
        text: job.result_text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        firstTokenMs: job.first_token_ms,
        latencyMs: job.latency_ms,
        workerId: job.worker_id,
        routingPreference: job.routing_preference,
        preferredNodeId: job.preferred_node_id,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not read owner improvement report.";

    return NextResponse.json(
      {
        error: "Could not read owner improvement report.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
