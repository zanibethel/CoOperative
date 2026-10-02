import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

type ProgressBody = {
  jobId?: unknown;
  workerId?: unknown;
  text?: unknown;
  outputTokens?: unknown;
  firstTokenMs?: unknown;
};

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProgressBody;
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

    const admin = createAdminSupabaseClient();
    const { data: job, error: jobError } = await admin
      .from("text_inference_jobs")
      .select("id,status,worker_id,personal_use")
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
      return NextResponse.json({ ok: true, cancelled: true, status: "cancelled" });
    }
    if (job.status !== "running") {
      return NextResponse.json({ ok: true, cancelled: false, status: job.status });
    }

    const partialText =
      typeof body.text === "string" ? body.text.slice(0, 200000) : "";
    const update: Record<string, unknown> = {
      // Personal prompts/responses are not retained in plaintext queue progress.
      partial_text: job.personal_use ? null : partialText,
      progress_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const outputTokens = asCount(body.outputTokens);
    const firstTokenMs = asCount(body.firstTokenMs);
    if (outputTokens !== null) update.output_tokens = outputTokens;
    if (firstTokenMs !== null) update.first_token_ms = firstTokenMs;

    const { error: updateError } = await admin
      .from("text_inference_jobs")
      .update(update)
      .eq("id", jobId)
      .eq("status", "running");

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, cancelled: false, status: "running" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not update inference progress.";
    return NextResponse.json(
      { error: "Could not update inference progress.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
