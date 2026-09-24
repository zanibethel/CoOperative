import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ChannelAuthorizationError,
  normalizeTelegramEvent,
  type TelegramUpdatePayload,
} from "@/lib/operative/channel-adapter";

/**
 * Telegram webhook — SECONDARY interface only.
 *
 * Per docs/CLOUD-OPERATIVE.md: "Telegram is secondary for
 * notifications/backup interaction" and "Telegram does not have independent
 * authority; it uses the same Owner Console/task policy." This handler exists
 * so the endpoint is ready, but two owner gates remain before it goes live:
 *
 *   1. `TELEGRAM_WEBHOOK_SECRET` must be set as a Vercel production secret
 *      (owner gate: production secret change) and compared against the
 *      `X-Telegram-Bot-Api-Secret-Token` header below.
 *   2. Telegram's `setWebhook` API must be called with this URL + the
 *      existing bot token (owner gate: this repoints where the owner's live
 *      bot delivers updates — "Telegram token creation/revocation if owner
 *      interaction is required" / effectively a production auth entry-point
 *      change). It also permanently disables the current long-polling Mac
 *      gateway for that bot, so cutover timing needs explicit owner sign-off.
 *
 * Until both are done, this route will reject all requests (missing secret)
 * and Telegram has no way to reach it (webhook not registered) — the existing
 * Mac long-polling gateway keeps working unaffected.
 *
 * This route also depends on the public.conversations, public.decisions, and
 * public.channel_identities tables in the proposed
 * database/schema-v0.2-operative.sql migration (owner gate: database
 * migration), and will 500 on any DB write until that is applied.
 */

function isAuthorizedTelegramRequest(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false; // fail closed until the owner sets the secret
  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  return provided === expected;
}

export async function POST(request: Request) {
  if (!isAuthorizedTelegramRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdatePayload;
  const chatId = update.message?.chat.id;
  if (chatId == null) {
    // No text message on this update (e.g. non-text content) — ack and skip.
    return NextResponse.json({ ok: true });
  }

  // Telegram has no browser Supabase session. After validating Telegram's
  // webhook secret and allow-listed chat identity, use the server-only Supabase
  // secret-key client for canonical writes. Never expose this key to the client.
  const supabase = createAdminClient();

  const { data: identity, error: identityError } = await supabase
    .from("channel_identities")
    .select("organization_id, owner_user_id, allow_listed, revoked_at")
    .eq("channel", "telegram")
    .eq("external_identity_ref", String(chatId))
    .maybeSingle();

  if (identityError) {
    return NextResponse.json({ error: identityError.message }, { status: 500 });
  }

  const mapping = {
    resolvedOwnerUserId: identity && !identity.revoked_at ? identity.owner_user_id : null,
    allowListed: identity?.allow_listed === true && !identity?.revoked_at,
  };

  let event;
  try {
    event = normalizeTelegramEvent(update, mapping, null);
  } catch (err) {
    if (err instanceof ChannelAuthorizationError) {
      // Ack with 200 so Telegram does not retry, but do not process the
      // message — an un-allow-listed chat has no CoOperative authority.
      return NextResponse.json({ ok: true, ignored: "not_allow_listed" });
    }
    throw err;
  }

  if (!event) {
    return NextResponse.json({ ok: true });
  }

  // Idempotency: Telegram may redeliver the same update_id on timeout.
  const { data: existing } = await supabase
    .from("conversation_messages")
    .select("id")
    .eq("idempotency_key", event.idempotencyKey ?? "")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let conversationId = event.conversationId;
  if (!conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({
        organization_id: identity!.organization_id,
        owner_user_id: identity!.owner_user_id,
        primary_channel: "owner-console",
      })
      .select("id")
      .single();

    if (conversationError) {
      return NextResponse.json({ error: conversationError.message }, { status: 500 });
    }
    conversationId = conversation.id;
  }

  const { error: messageError } = await supabase.from("conversation_messages").insert({
    conversation_id: conversationId,
    organization_id: identity!.organization_id,
    actor_id: event.actorId,
    actor_type: "owner",
    channel: event.channel,
    message_type: event.messageType,
    text: event.text,
    attachments: event.attachments,
    idempotency_key: event.idempotencyKey,
  });

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  // Telegram requires a fast ack; the advisor response/task creation happens
  // asynchronously and is delivered back via a separate outbound call, not
  // implemented in this stub.
  return NextResponse.json({ ok: true, conversationId });
}
