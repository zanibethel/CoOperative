import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(16000),
  modelMode: z.enum(["auto", "fast", "quality", "heavy"]).default("auto"),
  nodeId: z.string().min(1).max(160).optional(),
});

type NodeRow = {
  id: string;
  display_name: string;
  state: string;
  capabilities: unknown;
  last_seen_at: string;
};

function titleFromMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact || "New chat";
}

function chooseProfile(message: string, mode: "auto" | "fast" | "quality" | "heavy") {
  if (mode !== "auto") {
    return {
      profile: mode,
      reason: `${mode[0].toUpperCase() + mode.slice(1)} selected manually.`,
    };
  }

  const lower = message.toLowerCase();
  let score = 0;
  if (message.length > 1200) score += 1;
  if (message.length > 5000) score += 2;

  const qualityTerms = [
    "analyze",
    "compare",
    "plan",
    "debug",
    "code",
    "project",
    "design",
    "architecture",
    "research",
    "reason",
    "explain why",
  ];
  const heavyTerms = [
    "deeply",
    "thorough",
    "complex",
    "refactor",
    "root cause",
    "strategy",
    "step by step",
    "multi-step",
    "large",
  ];

  if (qualityTerms.some((term) => lower.includes(term))) score += 1;
  if (heavyTerms.some((term) => lower.includes(term))) score += 2;

  if (score >= 4) {
    return { profile: "heavy" as const, reason: "Auto chose Heavy for a complex request." };
  }
  if (score >= 2) {
    return { profile: "quality" as const, reason: "Auto chose Quality for a reasoning-heavy request." };
  }
  return { profile: "fast" as const, reason: "Auto chose Fast for a lightweight request." };
}

function nodeIsPersonalReady(node: NodeRow) {
  const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
  const seenAt = Date.parse(node.last_seen_at || "");
  return (
    Number.isFinite(seenAt) &&
    seenAt >= Date.now() - 90_000 &&
    node.state !== "paused" &&
    capabilities.includes("text_generation") &&
    capabilities.includes("local_personal_chat")
  );
}

async function settingsFor(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("personal_ai_settings")
    .select("hosted_history_enabled,improvement_opt_in,remote_enabled,preferred_node_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: createError } = await admin
    .from("personal_ai_settings")
    .insert({ user_id: userId })
    .select("hosted_history_enabled,improvement_opt_in,remote_enabled,preferred_node_id")
    .single();
  if (createError) throw createError;
  return created;
}

async function ownedNodes(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_nodes")
    .select("id,display_name,state,capabilities,last_seen_at")
    .eq("contributor_user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data || []) as NodeRow[];
}

async function readHistory(userId: string, conversationId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("personal_ai_read_messages", {
    p_user_id: userId,
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return (data || []) as Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    source_job_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = requestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const settings = await settingsFor(userId);

    if (!settings.remote_enabled) {
      return NextResponse.json(
        { error: "Remote Personal AI is disabled for this account." },
        { status: 409 },
      );
    }
    if (!settings.hosted_history_enabled) {
      return NextResponse.json(
        { error: "Hosted history must be enabled to use Personal AI from another device." },
        { status: 409 },
      );
    }

    const nodes = await ownedNodes(userId);
    let conversationId = input.conversationId || null;
    let targetNodeId: string | null = null;
    let conversationTitle = titleFromMessage(input.message);

    if (conversationId) {
      const { data: conversation, error: conversationError } = await admin
        .from("personal_ai_conversations")
        .select("id,node_id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
      targetNodeId = conversation.node_id;

      const { data: titles, error: titleError } = await admin.rpc(
        "personal_ai_list_conversations",
        { p_user_id: userId },
      );
      if (titleError) throw titleError;
      const match = (titles || []).find(
        (row: Record<string, unknown>) => row.id === conversationId,
      );
      if (typeof match?.title === "string") conversationTitle = match.title;
    } else {
      const requested =
        input.nodeId || settings.preferred_node_id || nodes.find(nodeIsPersonalReady)?.id || null;
      const selected = nodes.find((node) => node.id === requested && nodeIsPersonalReady(node));
      if (!selected) {
        return NextResponse.json(
          {
            error: "Your Personal AI PC is offline.",
            detail:
              "Turn on a linked PC with Personal Local AI installed. CoOperative will not silently use cloud AI.",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      targetNodeId = selected.id;

      const { data: createdId, error: createError } = await admin.rpc(
        "personal_ai_create_conversation",
        {
          p_user_id: userId,
          p_node_id: targetNodeId,
          p_title: conversationTitle,
          p_source: "mobile",
        },
      );
      if (createError) throw createError;
      conversationId = createdId as string;
    }

    const targetNode = nodes.find(
      (node) => node.id === targetNodeId && nodeIsPersonalReady(node),
    );
    if (!targetNode) {
      return NextResponse.json(
        {
          error: "Your Personal AI PC is offline.",
          detail:
            "This conversation stays tied to its PC. Turn that PC on to continue it.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const previous = await readHistory(userId, conversationId);
    const modelChoice = chooseProfile(input.message, input.modelMode);
    const history = previous.slice(-24).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const systemMessage = {
      role: "system",
      content:
        "You are CoOperative Personal AI running on the user's own Windows PC. " +
        "Be useful, clear, practical, and honest. This is personal use, not contributed compute. " +
        "Do not claim to have used cloud inference or paid APIs.",
    };
    const jobMessages = [
      systemMessage,
      ...history,
      { role: "user", content: input.message },
    ];
    const jobId = crypto.randomUUID();

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: `personal-user:${userId}`,
      messages: jobMessages,
      capability: "text",
      profile: modelChoice.profile,
      routing_preference: "require-node",
      target_node_id: targetNode.id,
      max_tokens: modelChoice.profile === "heavy" ? 1800 : modelChoice.profile === "quality" ? 1200 : 768,
      temperature: 0.3,
      routing_mode: modelChoice.profile === "heavy" ? "local-heavy" : modelChoice.profile === "quality" ? "local-quality" : "local-fast",
      task_class: modelChoice.profile === "heavy" ? "reasoning" : "general",
      route_reason: `Personal AI priority request. ${modelChoice.reason} Required owned node ${targetNode.display_name || targetNode.id}.`,
      allow_paid_fallback: false,
      human_approval_required: false,
      verification_status: "not_run",
      personal_use: true,
      personal_user_id: userId,
      personal_conversation_id: conversationId,
    });
    if (jobError) throw jobError;

    const { error: messageError } = await admin.rpc("personal_ai_append_message", {
      p_user_id: userId,
      p_conversation_id: conversationId,
      p_role: "user",
      p_content: input.message,
      p_source: "mobile",
      p_source_job_id: jobId,
      p_metadata: {
        modelMode: input.modelMode,
        selectedProfile: modelChoice.profile,
        nodeId: targetNode.id,
      },
    });

    if (messageError) {
      await admin.from("text_inference_jobs").delete().eq("id", jobId);
      throw messageError;
    }

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        conversationId,
        conversationTitle,
        node: {
          id: targetNode.id,
          displayName: targetNode.display_name,
          state: targetNode.state,
        },
        profile: modelChoice.profile,
        modelReason: modelChoice.reason,
        improvementOptIn: settings.improvement_opt_in,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not queue Personal AI.";
    return NextResponse.json(
      { error: "Could not queue Personal AI.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data: job, error } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,profile,personal_conversation_id,target_node_id,result_model,result_provider,prompt_tokens,output_tokens,latency_ms,worker_id,route_reason,error,created_at,completed_at",
      )
      .eq("id", jobId)
      .eq("personal_use", true)
      .eq("personal_user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    let text: string | null = null;
    if (job.status === "completed" && job.personal_conversation_id) {
      const messages = await readHistory(userId, job.personal_conversation_id);
      const assistant = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && message.source_job_id === jobId,
        );
      text = assistant?.content || null;
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        profile: job.profile,
        conversationId: job.personal_conversation_id,
        nodeId: job.target_node_id,
        text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        latencyMs: job.latency_ms,
        workerId: job.worker_id,
        routeReason: job.route_reason,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read Personal AI job.";
    return NextResponse.json(
      { error: "Could not read Personal AI job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
