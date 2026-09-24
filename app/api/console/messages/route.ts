import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeOwnerConsoleEvent } from "@/lib/operative/channel-adapter";

/**
 * CoOperative Owner Console — primary conversational intake.
 *
 * Per docs/CLOUD-OPERATIVE.md, the Owner Console is the primary owner
 * experience, not Telegram. This route appends an owner message to the
 * canonical conversation thread (public.conversations /
 * public.conversation_messages). It does not itself run the AI advisor or
 * create operative tasks — that orchestration belongs to a follow-up
 * playbook/advisor step once the Memory & Preference retrieval and Task
 * Policy Layer are implemented (docs/CLOUD-OPERATIVE.md components 2-5).
 *
 * NOTE: This route depends on the `public.conversations` and
 * `public.conversation_messages` tables defined in
 * database/schema-v0.2-operative.sql, which is a PROPOSED migration awaiting
 * owner approval. This route will 500 until that migration is applied.
 */

interface ConsoleMessageBody {
  conversationId?: string | null;
  text: string;
  attachments?: string[];
  replyToMessageId?: string | null;
  linkedTaskId?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as ConsoleMessageBody;
  if (!body?.text || typeof body.text !== "string") {
    return NextResponse.json({ error: "Missing message text" }, { status: 400 });
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (organizationError) {
    return NextResponse.json({ error: organizationError.message }, { status: 500 });
  }
  if (!organization) {
    return NextResponse.json(
      { error: "Create a workspace before starting a conversation.", code: "NO_ORGANIZATION" },
      { status: 409 },
    );
  }

  const event = normalizeOwnerConsoleEvent({
    conversationId: body.conversationId ?? null,
    ownerUserId: user.id,
    text: body.text,
    attachments: body.attachments,
    replyToMessageId: body.replyToMessageId,
    linkedTaskId: body.linkedTaskId,
  });

  let conversationId = event.conversationId;
  if (!conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({
        organization_id: organization.id,
        owner_user_id: user.id,
        primary_channel: "owner-console",
      })
      .select("id")
      .single();

    if (conversationError) {
      return NextResponse.json({ error: conversationError.message }, { status: 500 });
    }
    conversationId = conversation.id;
  }

  const { data: message, error: messageError } = await supabase
    .from("conversation_messages")
    .insert({
      conversation_id: conversationId,
      organization_id: organization.id,
      actor_id: user.id,
      actor_type: "owner",
      channel: event.channel,
      message_type: event.messageType,
      text: event.text,
      attachments: event.attachments,
      reply_to_message_id: event.replyTo,
      linked_task_id: event.linkedTaskId,
    })
    .select("id, created_at")
    .single();

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  return NextResponse.json(
    { conversationId, messageId: message.id, createdAt: message.created_at },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversation_messages")
    .select(
      "id, actor_id, actor_type, channel, message_type, text, attachments, linked_task_id, linked_decision_id, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}
