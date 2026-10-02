import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    nodeId: z.string().min(1).max(160),
    title: z.string().max(160).default("New chat"),
  }),
  z.object({
    action: z.literal("append"),
    nodeId: z.string().min(1).max(160),
    conversationId: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(200000),
    sourceJobId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
]);

async function nodeOwner(nodeId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_nodes")
    .select("id,contributor_user_id")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw error;
  return data?.contributor_user_id
    ? { admin, userId: data.contributor_user_id as string }
    : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nodeId = (url.searchParams.get("nodeId") || "").slice(0, 160);
  const conversationId = url.searchParams.get("conversationId");

  if (!nodeId || !(await authorizeUnisonNode(request, nodeId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const owner = await nodeOwner(nodeId);
    if (!owner) {
      return NextResponse.json({ error: "Node owner not found." }, { status: 404 });
    }

    if (!conversationId) {
      const { data, error } = await owner.admin.rpc("personal_ai_list_conversations", {
        p_user_id: owner.userId,
      });
      if (error) throw error;

      const conversations = (data || [])
        .filter((row: Record<string, unknown>) => row.node_id === nodeId)
        .map((row: Record<string, unknown>) => ({
          id: row.id,
          nodeId: row.node_id,
          title: row.title,
          source: row.source,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

      return NextResponse.json(
        { conversations },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: conversation, error: conversationError } = await owner.admin
      .from("personal_ai_conversations")
      .select("id,user_id,node_id,source,created_at,updated_at")
      .eq("id", conversationId)
      .eq("user_id", owner.userId)
      .eq("node_id", nodeId)
      .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const [{ data: titles, error: titleError }, { data: messages, error: messagesError }] =
      await Promise.all([
        owner.admin.rpc("personal_ai_list_conversations", { p_user_id: owner.userId }),
        owner.admin.rpc("personal_ai_read_messages", {
          p_user_id: owner.userId,
          p_conversation_id: conversationId,
        }),
      ]);
    if (titleError) throw titleError;
    if (messagesError) throw messagesError;

    const title = (titles || []).find(
      (row: Record<string, unknown>) => row.id === conversationId,
    )?.title;

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          nodeId: conversation.node_id,
          title: typeof title === "string" ? title : "Personal AI",
          source: conversation.source,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        },
        messages: (messages || []).map((row: Record<string, unknown>) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          sourceJobId: row.source_job_id,
          source: row.source,
          metadata: row.metadata,
          createdAt: row.created_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not sync Personal AI history.";
    return NextResponse.json(
      { error: "Could not sync Personal AI history.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  let input: z.infer<typeof mutationSchema>;
  try {
    input = mutationSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }

  if (!(await authorizeUnisonNode(request, input.nodeId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const owner = await nodeOwner(input.nodeId);
    if (!owner) {
      return NextResponse.json({ error: "Node owner not found." }, { status: 404 });
    }

    if (input.action === "create") {
      const { data, error } = await owner.admin.rpc("personal_ai_create_conversation", {
        p_user_id: owner.userId,
        p_node_id: input.nodeId,
        p_title: input.title,
        p_source: "desktop",
      });
      if (error) throw error;
      return NextResponse.json({ conversationId: data }, { status: 201 });
    }

    const { data: conversation, error: conversationError } = await owner.admin
      .from("personal_ai_conversations")
      .select("id")
      .eq("id", input.conversationId)
      .eq("user_id", owner.userId)
      .eq("node_id", input.nodeId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const { data, error } = await owner.admin.rpc("personal_ai_append_message", {
      p_user_id: owner.userId,
      p_conversation_id: input.conversationId,
      p_role: input.role,
      p_content: input.content,
      p_source: "desktop",
      p_source_job_id: input.sourceJobId || null,
      p_metadata: input.metadata,
    });
    if (error) throw error;

    return NextResponse.json({ messageId: data });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not sync Personal AI history.";
    return NextResponse.json(
      { error: "Could not sync Personal AI history.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
