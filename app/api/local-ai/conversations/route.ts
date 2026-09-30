import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

async function currentOwnerRef() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? `coop-user:${user.id}` : null;
}

export async function GET(request: Request) {
  const ownerRef = await currentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("id");

    if (conversationId) {
      const { data: conversation, error: conversationError } = await admin
        .from("local_ai_conversations")
        .select("id,title,profile,created_at,updated_at")
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();

      if (conversationError) throw conversationError;
      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }

      const { data: messages, error: messagesError } = await admin
        .from("local_ai_messages")
        .select("id,role,content,job_id,created_at")
        .eq("conversation_id", conversationId)
        .eq("owner_ref", ownerRef)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      return NextResponse.json(
        {
          conversation: {
            id: conversation.id,
            title: conversation.title,
            profile: conversation.profile,
            createdAt: conversation.created_at,
            updatedAt: conversation.updated_at,
          },
          messages: (messages || []).map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            jobId: message.job_id,
            createdAt: message.created_at,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data, error } = await admin
      .from("local_ai_conversations")
      .select("id,title,profile,created_at,updated_at")
      .eq("owner_ref", ownerRef)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    return NextResponse.json(
      {
        conversations: (data || []).map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          profile: conversation.profile,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read Local AI conversations.";
    return NextResponse.json(
      { error: "Could not read Local AI conversations.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  const ownerRef = await currentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("id");

    if (!conversationId) {
      return NextResponse.json({ error: "Conversation id is required." }, { status: 400 });
    }

    const { error } = await admin
      .from("local_ai_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("owner_ref", ownerRef);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not delete Local AI conversation.";
    return NextResponse.json(
      { error: "Could not delete Local AI conversation.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
