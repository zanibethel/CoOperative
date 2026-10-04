import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";

export const runtime = "nodejs";
export const maxDuration = 30;

async function currentOwnerRef() {
  const userId = await mainCooperativeUserId();
  return userId ? `coop-user:${userId}` : null;
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
        .select("id,title,profile,business_id,created_at,updated_at")
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();

      if (conversationError) throw conversationError;
      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }

      const { data: messages, error: messagesError } = await admin
        .from("local_ai_messages")
        .select("id,role,content,attachment_ids,job_id,created_at")
        .eq("conversation_id", conversationId)
        .eq("owner_ref", ownerRef)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      const messageRows = messages || [];
      const attachmentIds = Array.from(
        new Set(
          messageRows.flatMap((message) =>
            Array.isArray(message.attachment_ids) ? message.attachment_ids : [],
          ),
        ),
      );

      const attachmentMap = new Map<
        string,
        { id: string; fileName: string; mimeType: string; sizeBytes: number; previewUrl: string }
      >();

      if (attachmentIds.length > 0) {
        const { data: attachments, error: attachmentError } = await admin
          .from("local_ai_attachments")
          .select("id,file_name,mime_type,size_bytes")
          .eq("owner_ref", ownerRef)
          .in("id", attachmentIds);

        if (attachmentError) throw attachmentError;

        for (const attachment of attachments || []) {
          attachmentMap.set(attachment.id, {
            id: attachment.id,
            fileName: attachment.file_name,
            mimeType: attachment.mime_type,
            sizeBytes: attachment.size_bytes,
            previewUrl: `/api/local-ai/attachments?id=${attachment.id}`,
          });
        }
      }

      return NextResponse.json(
        {
          conversation: {
            id: conversation.id,
            title: conversation.title,
            profile: conversation.profile,
            businessId: conversation.business_id || null,
            createdAt: conversation.created_at,
            updatedAt: conversation.updated_at,
          },
          messages: messageRows.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            attachments: (Array.isArray(message.attachment_ids)
              ? message.attachment_ids
              : []
            )
              .map((id) => attachmentMap.get(id))
              .filter(Boolean),
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

    const { data: attachments, error: attachmentError } = await admin
      .from("local_ai_attachments")
      .select("storage_path")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", ownerRef);

    if (attachmentError) throw attachmentError;

    const storagePaths = (attachments || []).map((attachment) => attachment.storage_path);
    if (storagePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from("local-ai-attachments")
        .remove(storagePaths);
      if (storageError) throw storageError;
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
