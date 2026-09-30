import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import { AGENT_REGISTRY, AGENT_REPOSITORIES } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  userId: z.string().min(1).max(200),
  creatorId: z.string().uuid(),
  creatorName: z.string().min(1).max(200),
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(16000),
  context: z.record(z.string(), z.unknown()).default({}),
  pageContext: z.string().max(200).optional(),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function ownerRef(userId: string, creatorId: string) {
  return `creatorhub:${userId}:${creatorId}`;
}

function looksLikeRepoChange(message: string) {
  const value = message.toLowerCase();
  const codeWords = /(code|repo|repository|bug|fix|implement|update|change|refactor|build|route|api|component|database|schema|deployment)/;
  const actionWords = /(fix|implement|update|change|refactor|build|add|remove|debug|inspect|investigate)/;
  return codeWords.test(value) && actionWords.test(value);
}

function chooseProfile(message: string) {
  const value = message.toLowerCase();
  const complex =
    message.length > 260 ||
    /(why|analy[sz]e|debug|compare|plan|architecture|design|investigate|complex|tradeoff|strategy|root cause)/.test(value);
  return complex ? "quality" : "fast";
}

function titleFromMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = requestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const owner = ownerRef(input.userId, input.creatorId);

    if (looksLikeRepoChange(input.message)) {
      const taskId = crypto.randomUUID();
      const objective = [
        `CreatorHub chat request for creator "${input.creatorName}".`,
        `User request: ${input.message}`,
        `Page context: ${input.pageContext || "CreatorHub dashboard"}.`,
        `Creator context: ${JSON.stringify(input.context).slice(0, 10000)}`,
        "Inspect current CreatorHub repository evidence first. Use deterministic tooling before model reasoning. Prepare the smallest safe change that satisfies the request. Do not push or deploy; stop for review.",
      ].join("\n\n");

      const { error } = await admin.from("agent_tasks").insert({
        id: taskId,
        owner_ref: owner,
        agent_key: "repo-engineer",
        repo_key: "creatorhub",
        mode: "prepare_change",
        objective,
        requested_profile: "quality",
        status: "queued",
      });
      if (error) throw error;

      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: owner,
        kind: "queued",
        message: "CreatorHub chat handed this request to Repo Engineer.",
        metadata: {
          source: "creatorhub-chat",
          creatorId: input.creatorId,
          creatorName: input.creatorName,
          agentRevision: "2026-09-30.1",
        },
      });

      return NextResponse.json(
        {
          mode: "agent",
          agent: AGENT_REGISTRY["repo-engineer"],
          repository: AGENT_REPOSITORIES.creatorhub,
          taskId,
          status: "queued",
          text: "I handed that to the CreatorHub Repo Engineer. It will inspect the current code first, use Local Quality only where needed, run the allowlisted checks, and stop with a prepared change for review.",
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    const profile = chooseProfile(input.message);
    let conversationId = input.conversationId;

    if (conversationId) {
      const { data: existing, error } = await admin
        .from("local_ai_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("owner_ref", owner)
        .maybeSingle();
      if (error) throw error;
      if (!existing) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
    } else {
      conversationId = crypto.randomUUID();
      const { error } = await admin.from("local_ai_conversations").insert({
        id: conversationId,
        owner_ref: owner,
        title: titleFromMessage(input.message),
        profile,
      });
      if (error) throw error;
    }

    const { data: previousMessages, error: historyError } = await admin
      .from("local_ai_messages")
      .select("role,content")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", owner)
      .order("created_at", { ascending: false })
      .limit(20);
    if (historyError) throw historyError;

    const systemMessage = {
      role: "system" as const,
      content: [
        "You are CoOperative AI inside CreatorHub.",
        "CreatorHub already checked deterministic/code-first answers before calling you, so use the supplied live context as authoritative and do not invent current state.",
        "Prefer concise practical answers. If the request is about changing code, do not pretend you changed it; code changes belong to the Repo Engineer agent.",
        "Do not enable paid fallback or claim a hosted model was used.",
        `Active creator: ${input.creatorName}.`,
        `Current page/module: ${input.pageContext || "CreatorHub dashboard"}.`,
        `Live CreatorHub context: ${JSON.stringify(input.context).slice(0, 12000)}`,
      ].join("\n"),
    };

    const history = [...(previousMessages || [])]
      .reverse()
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content as string,
      }));

    const jobId = crypto.randomUUID();
    const messages = [
      systemMessage,
      ...history,
      { role: "user" as const, content: input.message },
    ].slice(-24);

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: owner,
      conversation_id: conversationId,
      messages,
      attachment_ids: [],
      capability: "text",
      profile,
      max_tokens: profile === "quality" ? 1400 : 800,
      temperature: 0.2,
      routing_mode: profile === "quality" ? "local-quality" : "local-fast",
      task_class: "general",
      route_reason:
        profile === "quality"
          ? "CreatorHub complex chat request routed to Local Quality after code-first checks."
          : "CreatorHub chat request routed to Local Fast after code-first checks.",
      allow_paid_fallback: false,
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
    });
    if (jobError) throw jobError;

    const { error: messageError } = await admin.from("local_ai_messages").insert({
      conversation_id: conversationId,
      owner_ref: owner,
      role: "user",
      content: input.message,
      attachment_ids: [],
      job_id: jobId,
    });
    if (messageError) {
      await admin.from("text_inference_jobs").delete().eq("id", jobId);
      throw messageError;
    }

    await admin
      .from("local_ai_conversations")
      .update({ profile, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("owner_ref", owner);

    return NextResponse.json(
      {
        mode: profile === "quality" ? "local-quality" : "local-fast",
        jobId,
        conversationId,
        profile,
        status: "queued",
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "CreatorHub bridge failed.";
    return NextResponse.json(
      { error: "CreatorHub bridge failed.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "";
    const creatorId = url.searchParams.get("creatorId") || "";
    const jobId = url.searchParams.get("jobId") || "";
    const taskId = url.searchParams.get("taskId") || "";
    if (!userId || !creatorId || (!jobId && !taskId)) {
      return NextResponse.json({ error: "Missing status parameters." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const owner = ownerRef(userId, creatorId);

    if (taskId) {
      const { data: task, error } = await admin
        .from("agent_tasks")
        .select("id,status,result,error,branch_name,updated_at,completed_at")
        .eq("id", taskId)
        .eq("owner_ref", owner)
        .maybeSingle();
      if (error) throw error;
      if (!task) return NextResponse.json({ error: "Agent task not found." }, { status: 404 });

      return NextResponse.json(
        {
          mode: "agent",
          taskId: task.id,
          status: task.status,
          branchName: task.branch_name,
          result: task.result,
          error: task.error,
          updatedAt: task.updated_at,
          completedAt: task.completed_at,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select("id,status,profile,conversation_id,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,error,created_at,completed_at")
      .eq("id", jobId)
      .eq("client_owner_ref", owner)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Chat job not found." }, { status: 404 });

    return NextResponse.json(
      {
        mode: job.profile === "quality" ? "local-quality" : "local-fast",
        jobId: job.id,
        conversationId: job.conversation_id,
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
    const detail = error instanceof Error ? error.message : "Could not read bridge status.";
    return NextResponse.json(
      { error: "Could not read bridge status.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
