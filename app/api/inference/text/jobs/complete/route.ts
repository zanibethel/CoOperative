import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

type CompletionBody = {
  jobId?: unknown;
  workerId?: unknown;
  text?: unknown;
  model?: unknown;
  provider?: unknown;
  promptTokens?: unknown;
  outputTokens?: unknown;
  latencyMs?: unknown;
  error?: unknown;
};

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

async function recordUnisonTextUsage(
  supabase: AdminClient,
  input: {
    jobId: string;
    workerId: string | null;
    claimedAt: string | null;
    status: "completed" | "failed";
    completedAt: string;
    latencyMs: number | null;
  },
) {
  if (!input.workerId) return;

  try {
    const { data: node, error: nodeError } = await supabase
      .from("unison_nodes")
      .select("contributor_user_id,resources")
      .eq("id", input.workerId)
      .maybeSingle();

    if (nodeError || !node?.contributor_user_id) return;

    const claimedMs = input.claimedAt ? Date.parse(input.claimedAt) : NaN;
    const completedMs = Date.parse(input.completedAt);
    const elapsedSeconds =
      Number.isFinite(claimedMs) && Number.isFinite(completedMs)
        ? Math.max(0, Math.ceil((completedMs - claimedMs) / 1000))
        : 0;
    const computeSeconds =
      input.latencyMs !== null
        ? Math.max(0, Math.ceil(input.latencyMs / 1000))
        : elapsedSeconds;

    const resources = (node.resources || {}) as { gpus?: Array<unknown> };
    const gpuSeconds = resources.gpus?.length ? computeSeconds : 0;

    const { error } = await supabase.from("unison_usage_ledger").upsert(
      {
        contributor_user_id: node.contributor_user_id,
        node_id: input.workerId,
        source_job_type: "text_generation",
        source_job_id: input.jobId,
        status: input.status,
        compute_seconds: computeSeconds,
        gpu_seconds: gpuSeconds,
        cpu_seconds: gpuSeconds ? 0 : computeSeconds,
        earned_cents: 0,
        estimated_external_cost_cents: 0,
        started_at: input.claimedAt,
        completed_at: input.completedAt,
      },
      { onConflict: "source_job_type,source_job_id" },
    );

    if (error) {
      console.error("Could not record Unison text contribution", {
        jobId: input.jobId,
        workerId: input.workerId,
        detail: error.message.slice(0, 500),
      });
    }
  } catch (error) {
    console.error("Could not record Unison text contribution", {
      jobId: input.jobId,
      workerId: input.workerId,
      detail: error instanceof Error ? error.message.slice(0, 500) : "Unknown ledger error",
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompletionBody;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : null;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error: jobError } = await supabase
      .from("text_inference_jobs")
      .select("id,status,client_owner_ref,conversation_id,worker_id,claimed_at")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (workerId && job.worker_id && job.worker_id !== workerId) {
      return NextResponse.json(
        { error: "This job is leased to a different node." },
        { status: 409 },
      );
    }
    if (job.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (typeof body.error === "string" && body.error.trim()) {
      const completedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error: body.error.slice(0, 1200),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", jobId);

      if (updateError) throw updateError;

      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "failed",
        completedAt,
        latencyMs: null,
      });

      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.text !== "string" || !body.text.trim() || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const latencyMs = asCount(body.latencyMs);
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("text_inference_jobs")
      .update({
        status: "completed",
        partial_text: body.text,
        result_text: body.text,
        result_model: body.model.slice(0, 300),
        result_provider:
          typeof body.provider === "string"
            ? body.provider.slice(0, 160)
            : "cooperative-local-text-worker",
        prompt_tokens: asCount(body.promptTokens),
        output_tokens: asCount(body.outputTokens),
        latency_ms: latencyMs,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId);

    if (updateError) throw updateError;

    await recordUnisonTextUsage(supabase, {
      jobId,
      workerId,
      claimedAt: job.claimed_at,
      status: "completed",
      completedAt,
      latencyMs,
    });

    if (job.conversation_id) {
      const { error: messageError } = await supabase.from("local_ai_messages").upsert(
        {
          conversation_id: job.conversation_id,
          owner_ref: job.client_owner_ref,
          role: "assistant",
          content: body.text.trim(),
          job_id: jobId,
        },
        { onConflict: "job_id,role" },
      );

      if (messageError) throw messageError;

      const { error: conversationError } = await supabase
        .from("local_ai_conversations")
        .update({ updated_at: completedAt })
        .eq("id", job.conversation_id)
        .eq("owner_ref", job.client_owner_ref);

      if (conversationError) throw conversationError;
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete text inference job.";
    console.error("CoOperative text inference completion failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not complete text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
