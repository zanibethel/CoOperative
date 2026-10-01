import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  collectOwnerImprovementEvidence,
  ownerImprovementReportPrompt,
} from "@/lib/ai/owner-improvement-evidence";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  action: z.literal("generate_report").default("generate_report"),
});

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

    requestSchema.parse(await request.json());

    const evidence = await collectOwnerImprovementEvidence(owner.userId);
    const admin = createAdminSupabaseClient();
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
      route_reason:
        "Owner Improvement Report compiled from aggregate internal telemetry. Owned/local Quality model only; paid fallback disabled.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
    });

    if (error) throw error;

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        evidence,
        compiler: {
          route: "local-quality",
          paidFallback: false,
          modelRegistryRevision: TEXT_MODEL_REGISTRY_REVISION,
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
      return NextResponse.json(
        { evidence },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,error,created_at,completed_at",
      )
      .eq("id", jobId)
      .eq("client_owner_ref", owner.ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return NextResponse.json({ error: "Report job not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
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
