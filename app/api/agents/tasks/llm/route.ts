import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import { localWorkerAuthorized } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const createSchema = z.object({
  taskId: z.string().uuid(),
  messages: z.array(textInferenceMessageSchema).min(1).max(20),
  profile: z.enum(["fast","quality"]).default("fast"),
  maxTokens: z.number().int().min(64).max(4096).default(1600),
  temperature: z.number().min(0).max(1).default(0.1),
});

export async function POST(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = createSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const { data: task, error: taskError } = await admin
      .from("agent_tasks")
      .select("id,status")
      .eq("id", input.taskId)
      .maybeSingle();

    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (!["running","waiting_llm"].includes(task.status)) {
      return NextResponse.json(
        { error: `Task is not active: ${task.status}` },
        { status: 409 },
      );
    }

    const jobId = crypto.randomUUID();
    const { error } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: `agent-task:${input.taskId}`,
      agent_task_id: input.taskId,
      messages: input.messages,
      profile: input.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.profile === "quality" ? "local-quality" : "local-fast",
      task_class: "coding",
      route_reason: "Bounded local agent reasoning request.",
      allow_paid_fallback: false,
      human_approval_required: true,
      model_registry_revision: "2026-09-30.2",
      verification_status: "not_run",
      capability: "text",
    });
    if (error) throw error;

    await admin.from("agent_tasks").update({
      status: "waiting_llm",
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskId);

    return NextResponse.json(
      { jobId, status: "queued", profile: input.profile },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not queue agent LLM work.";
    return NextResponse.json(
      { error: "Could not queue agent LLM work.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  if (!localWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId") || "";
    const jobId = url.searchParams.get("jobId") || "";
    if (!taskId || !jobId) {
      return NextResponse.json({ error: "taskId and jobId are required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select("id,status,profile,partial_text,result_text,result_model,prompt_tokens,output_tokens,latency_ms,error")
      .eq("id", jobId)
      .eq("agent_task_id", taskId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    if (["completed","failed","cancelled"].includes(job.status)) {
      await admin.from("agent_tasks").update({
        status: "running",
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("status", "waiting_llm");
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      profile: job.profile,
      partialText: job.partial_text,
      text: job.result_text,
      model: job.result_model,
      promptTokens: job.prompt_tokens,
      outputTokens: job.output_tokens,
      latencyMs: job.latency_ms,
      error: job.error,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read agent LLM work.";
    return NextResponse.json(
      { error: "Could not read agent LLM work.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
