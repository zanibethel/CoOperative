import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type CompletionBody = {
  jobId?: unknown;
  text?: unknown;
  model?: unknown;
  provider?: unknown;
  promptTokens?: unknown;
  outputTokens?: unknown;
  latencyMs?: unknown;
  error?: unknown;
};

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CompletionBody;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error: jobError } = await supabase
      .from("text_inference_jobs")
      .select("id,status,client_owner_ref,conversation_id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (typeof body.error === "string" && body.error.trim()) {
      const { error: updateError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "failed",
          error: body.error.slice(0, 1200),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      if (updateError) throw updateError;
      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.text !== "string" || !body.text.trim() || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const asCount = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.round(value))
        : null;

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
            : "cooperative-mlx-worker",
        prompt_tokens: asCount(body.promptTokens),
        output_tokens: asCount(body.outputTokens),
        latency_ms: asCount(body.latencyMs),
        error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) throw updateError;

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
        .update({ updated_at: new Date().toISOString() })
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
