import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminSupabaseClient();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("id");

    if (!conversationId) {
      const { data, error } = await admin.rpc("personal_ai_list_conversations", {
        p_user_id: userId,
      });
      if (error) throw error;

      return NextResponse.json(
        {
          conversations: (data || []).map((row: Record<string, unknown>) => ({
            id: row.id,
            nodeId: row.node_id,
            title: row.title,
            source: row.source,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: conversation, error: conversationError } = await admin
      .from("personal_ai_conversations")
      .select("id,user_id,node_id,source,created_at,updated_at")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const { data: titleRows, error: titleError } = await admin.rpc(
      "personal_ai_list_conversations",
      { p_user_id: userId },
    );
    if (titleError) throw titleError;
    const titleRow = (titleRows || []).find(
      (row: Record<string, unknown>) => row.id === conversationId,
    );

    const { data: messages, error: messagesError } = await admin.rpc(
      "personal_ai_read_messages",
      {
        p_user_id: userId,
        p_conversation_id: conversationId,
      },
    );
    if (messagesError) throw messagesError;

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          nodeId: conversation.node_id,
          title: titleRow?.title || "Personal AI",
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
      error instanceof Error ? error.message : "Could not load Personal AI history.";
    return NextResponse.json(
      { error: "Could not load Personal AI history.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const conversationId = new URL(request.url).searchParams.get("id");
    if (!conversationId) {
      return NextResponse.json({ error: "Conversation id is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { error } = await admin
      .from("personal_ai_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not delete Personal AI conversation.";
    return NextResponse.json(
      { error: "Could not delete Personal AI conversation.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
