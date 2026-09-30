import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { routedTextInferenceRequestSchema } from "@/lib/inference/contracts";
import {
  routeTextRequest,
  TEXT_MODEL_REGISTRY,
} from "@/lib/inference/text-model-registry";

export const runtime = "nodejs";
export const maxDuration = 30;

const enqueueSchema = routedTextInferenceRequestSchema.extend({
  clientOwnerRef: z.string().min(1).max(160),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = enqueueSchema.parse(await request.json());
    const decision = routeTextRequest(input);
    const supabase = createAdminSupabaseClient();
    const jobId = crypto.randomUUID();

    const { error } = await supabase.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: input.clientOwnerRef,
      messages: input.messages,
      profile: decision.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.mode,
      task_class: input.taskClass,
      route_reason: decision.reason,
      allow_paid_fallback: decision.paidFallbackAllowed,
      human_approval_required: decision.humanApprovalRequired,
      model_registry_revision: decision.registryRevision,
      verification_status: "not_run",
    });

    if (error) throw error;

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        profile: decision.profile,
        route: {
          mode: input.mode,
          taskClass: input.taskClass,
          reason: decision.reason,
          registryRevision: decision.registryRevision,
          profileDefaultModelId:
            TEXT_MODEL_REGISTRY[decision.profile].defaultModelId,
          paidFallbackAllowed: decision.paidFallbackAllowed,
          humanApprovalRequired: decision.humanApprovalRequired,
          automaticPaidFallback: false,
        },
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not route text inference.";
    console.error("CoOperative text routing failed", {
      detail: detail.slice(0, 800),
    });

    return NextResponse.json(
      { error: "Could not route text inference.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
