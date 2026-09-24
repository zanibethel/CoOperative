import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChannelAuthorizationError,
  normalizeOwnerConsoleEvent,
  normalizeTelegramEvent,
} from "../lib/operative/channel-adapter.ts";

test("owner console events normalize into the canonical channel event shape", () => {
  const event = normalizeOwnerConsoleEvent({
    conversationId: null,
    ownerUserId: "owner-1",
    text: "What is the status of the Square connector?",
  });
  assert.equal(event.channel, "owner-console");
  assert.equal(event.actorId, "owner-1");
  assert.equal(event.messageType, "text");
});

test("telegram events from an allow-listed chat normalize correctly with an idempotency key", () => {
  const event = normalizeTelegramEvent(
    {
      update_id: 42,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        chat: { id: 123 },
        text: "Approve the first option only.",
      },
    },
    { resolvedOwnerUserId: "owner-1", allowListed: true },
    null,
  );
  assert.ok(event);
  assert.equal(event?.channel, "telegram");
  assert.equal(event?.actorId, "owner-1");
  assert.equal(event?.idempotencyKey, "telegram:42");
});

test("telegram events from a non-allow-listed chat are rejected, not silently processed", () => {
  assert.throws(
    () =>
      normalizeTelegramEvent(
        {
          update_id: 1,
          message: { message_id: 1, date: 0, chat: { id: 999 }, text: "hello" },
        },
        { resolvedOwnerUserId: null, allowListed: false },
        null,
      ),
    ChannelAuthorizationError,
  );
});

test("telegram updates without a text message normalize to null so the webhook can skip them", () => {
  const event = normalizeTelegramEvent(
    { update_id: 2, message: { message_id: 2, date: 0, chat: { id: 123 } } },
    { resolvedOwnerUserId: "owner-1", allowListed: true },
    null,
  );
  assert.equal(event, null);
});
