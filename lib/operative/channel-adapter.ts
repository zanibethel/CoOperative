import { ChannelEventSchema, type Channel, type ChannelEvent } from "../domain/operative-schemas.ts";

/**
 * Channel adapters — normalize native channel payloads into the canonical
 * ChannelEvent shape defined in docs/OMNICHANNEL-CONVERSATIONS.md
 * "Channel adapters":
 *
 *   { conversation_id, actor_id, channel, timestamp, message_type,
 *     text, attachments, reply_to, linked_task_id }
 *
 * "The rest of CoOperative should not care which channel produced the event."
 * Nothing downstream of `normalize*Event` should branch on the source channel;
 * all channel-specific parsing lives in this file.
 */

// ---------------------------------------------------------------------------
// Owner Console (primary channel)
// ---------------------------------------------------------------------------

export interface OwnerConsoleInboundMessage {
  conversationId: string | null;
  ownerUserId: string;
  text: string;
  attachments?: string[];
  replyToMessageId?: string | null;
  linkedTaskId?: string | null;
}

export function normalizeOwnerConsoleEvent(input: OwnerConsoleInboundMessage): ChannelEvent {
  return ChannelEventSchema.parse({
    conversationId: input.conversationId,
    actorId: input.ownerUserId,
    channel: "owner-console" satisfies Channel,
    messageType: "text",
    text: input.text,
    attachments: input.attachments ?? [],
    replyTo: input.replyToMessageId ?? null,
    linkedTaskId: input.linkedTaskId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Telegram (secondary channel — see docs/CLOUD-OPERATIVE.md "Telegram does not
// have independent authority; it uses the same Owner Console/task policy.")
// ---------------------------------------------------------------------------

/** Minimal shape of the fields we read from a Telegram Bot API update. */
export interface TelegramUpdatePayload {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
  };
}

export interface TelegramChannelMapping {
  /** Resolved via public.channel_identities — never a token/secret value. */
  resolvedOwnerUserId: string | null;
  allowListed: boolean;
}

/**
 * Normalize a Telegram update into a ChannelEvent. Returns `null` when the
 * update carries no text message (e.g. edited_message, non-text content types
 * not yet supported) so the webhook handler can ack Telegram with 200 and
 * skip it without creating a canonical event.
 *
 * The webhook handler is responsible for resolving `mapping` from
 * `public.channel_identities` (allow-list check) BEFORE calling this — this
 * function does not perform authorization, only shape normalization, per the
 * separation of concerns described in docs/OMNICHANNEL-CONVERSATIONS.md
 * "Security": "explicit owner/channel linking" happens at the identity layer.
 */
export function normalizeTelegramEvent(
  update: TelegramUpdatePayload,
  mapping: TelegramChannelMapping,
  linkedConversationId: string | null,
): ChannelEvent | null {
  const message = update.message;
  if (!message?.text) return null;
  if (!mapping.allowListed || !mapping.resolvedOwnerUserId) {
    throw new ChannelAuthorizationError(
      `Telegram chat ${message.chat.id} is not an allow-listed owner identity.`,
    );
  }

  return ChannelEventSchema.parse({
    conversationId: linkedConversationId,
    actorId: mapping.resolvedOwnerUserId,
    channel: "telegram" satisfies Channel,
    timestamp: new Date(message.date * 1000).toISOString(),
    messageType: "text",
    text: message.text,
    attachments: [],
    replyTo: null,
    linkedTaskId: null,
    idempotencyKey: `telegram:${update.update_id}`,
  });
}

export class ChannelAuthorizationError extends Error {}

// ---------------------------------------------------------------------------
// ChatGPT bridge (future secondary channel — docs/OMNICHANNEL-CONVERSATIONS.md
// "ChatGPT bridge"). Stubbed contract only; no live connector exists yet.
// ---------------------------------------------------------------------------

export interface ChatGptBridgeMessage {
  conversationId: string | null;
  ownerUserId: string;
  text: string;
  linkedTaskId?: string | null;
}

export function normalizeChatGptEvent(input: ChatGptBridgeMessage): ChannelEvent {
  return ChannelEventSchema.parse({
    conversationId: input.conversationId,
    actorId: input.ownerUserId,
    channel: "chatgpt" satisfies Channel,
    messageType: "text",
    text: input.text,
    attachments: [],
    replyTo: null,
    linkedTaskId: input.linkedTaskId ?? null,
  });
}
