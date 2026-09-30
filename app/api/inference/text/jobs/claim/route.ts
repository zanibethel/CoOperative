import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { workerId?: unknown };
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : "local-text-worker";

    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.rpc("claim_next_text_inference_job", {
      p_worker_id: workerId,
    });
    if (error) throw error;

    const job = Array.isArray(data) ? data[0] : null;
    if (!job) {
      return new Response(null, { status: 204 });
    }

    return NextResponse.json(
      {
        jobId: job.id,
        messages: job.messages,
        profile: job.profile,
        maxTokens: job.max_tokens,
        temperature: Number(job.temperature),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not claim text inference job.";
    console.error("CoOperative text inference claim failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not claim text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
