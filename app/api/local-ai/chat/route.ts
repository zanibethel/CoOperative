import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { textInferenceRequestSchema } from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 30;

async function currentOwnerRef() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? `coop-user:${user.id}` : null;
}

export async function POST(request: Request) {
  const ownerRef = await currentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = textInferenceRequestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const jobId = crypto.randomUUID();

    const { error } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: ownerRef,
      messages: input.messages,
      profile: input.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });

    if (error) throw error;

    return NextResponse.json(
      { jobId, status: "queued", profile: input.profile },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not queue local AI chat.";
    return NextResponse.json(
      { error: "Could not queue local AI chat.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const ownerRef = await currentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,profile,result_text,result_model,result_provider,prompt_tokens,output_tokens,latency_ms,error,created_at,completed_at",
      )
      .eq("id", jobId)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        profile: job.profile,
        text: job.result_text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        latencyMs: job.latency_ms,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read local AI chat job.";
    return NextResponse.json(
      { error: "Could not read local AI chat job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
