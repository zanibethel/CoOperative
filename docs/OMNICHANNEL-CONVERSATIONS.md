# CoOperative Omnichannel Conversation Architecture

## Goal

The owner should experience one continuous CoOperative relationship across:

- CoOperative Owner Console;
- ChatGPT through a CoOperative connector/bridge;
- Telegram;
- future approved channels.

A conversation started in one channel should be resumable in another without re-explaining context.

The system should behave as if every channel is another window into the same CoOperative brain/state.

## Canonical rule

> CoOperative is the system of record. Channels are interfaces.

Do not let ChatGPT, Telegram, or the Owner Console maintain separate authoritative memories.

Each channel should submit normalized conversation events into CoOperative and retrieve the same durable context from CoOperative.

## Canonical conversation state

Persist:

- conversation/thread id;
- owner/user id;
- organization/project scope;
- messages/events;
- source channel;
- linked tasks;
- linked decisions;
- linked approvals;
- linked artifacts;
- structured memories extracted;
- task status/results;
- assistant/model/provider used;
- timestamps and ordering.

The conversation history and task history should remain available even when the model/provider changes.

## Channel adapters

Each channel adapter should convert native messages into a common event format.

Example:

```text
{
  conversation_id,
  actor_id,
  channel,
  timestamp,
  message_type,
  text,
  attachments,
  reply_to,
  linked_task_id
}
```

Adapters may include:

- `owner-console`
- `chatgpt`
- `telegram`

The rest of CoOperative should not care which channel produced the event.

## Shared response pipeline

For every owner message:

```text
channel message
  -> normalize event
  -> store in canonical conversation
  -> retrieve relevant memory + decisions + tasks
  -> run policy / playbook / AI routing
  -> produce canonical response
  -> store response
  -> deliver response to originating channel
  -> optionally sync to other active channels
```

## Same assistant identity

The owner should receive a consistent advisor experience regardless of channel.

Consistency comes from:

- shared memory;
- shared policy;
- shared business/project state;
- shared task state;
- shared decision history;
- shared prompt/behavior contract;
- shared model-routing rules.

The exact underlying model may differ by task/cost, but the advisor should still reflect the same CoOperative operating principles and current owner context.

## ChatGPT bridge

A ChatGPT/CoOperative connector should be able to:

- append the current user message to a CoOperative thread;
- retrieve current thread context;
- retrieve relevant structured memory;
- create operative tasks;
- read task status/results;
- list pending approvals;
- submit an explicit owner approval/rejection/modification;
- attach artifacts/references;
- write the assistant response back into the canonical thread.

Do not expose unrestricted shell/database access through the bridge.

### Important limitation

CoOperative cannot automatically read arbitrary past ChatGPT conversations unless the owner explicitly connects/provides them through an available supported integration.

From the point the bridge is active, new messages should sync automatically.

Historical import should be a separate owner-approved process.

## Telegram adapter

Telegram should be a secondary mobile interface into the same conversation/task system.

A Telegram message should:

- authenticate/allow-list the owner;
- map to the correct CoOperative owner identity;
- append to the canonical thread;
- load the same memory/task context;
- return the same style of advisor response;
- surface the same Decision Briefs;
- submit approvals through the same approval contract.

Telegram must not maintain independent authority or independent memory.

## Owner Console

The Owner Console is the canonical UI for:

- threads;
- task history;
- decision history;
- approvals;
- memory;
- artifacts;
- cost/economic impact;
- channel activity.

It should clearly show which channel each message originated from while keeping one unified thread.

## Cross-channel continuity examples

### Example 1

```text
ChatGPT:
"Have Hermes investigate Square."

CoOperative:
creates task + stores discussion

Later in Owner Console:
"Where are we on Square?"

Response:
loads the same Square task and prior decision context
```

### Example 2

```text
Owner Console:
reviews a Decision Brief

Telegram:
"Approve the first option only."

CoOperative:
maps the Telegram owner identity
updates the same pending decision
resumes the same task
writes the result back to the canonical thread
```

### Example 3

```text
Telegram:
"I don't want us adding another monthly subscription for this."

CoOperative:
extracts a durable owner preference/policy candidate
stores it with provenance

Later in ChatGPT:
advisor retrieves the same preference before proposing infrastructure
```

## Event ordering and conflicts

Multiple channels may be active simultaneously.

The system should:

- timestamp all events server-side;
- maintain stable event ordering;
- prevent duplicate delivery from creating duplicate actions;
- use idempotency keys for action/approval events;
- detect conflicting owner approvals;
- pause consequential actions when two channels submit contradictory instructions.

For high-impact conflicts, ask the owner to resolve them explicitly.

## Notifications vs conversations

Not every channel needs every event.

Examples:

- Owner Console: full canonical history.
- ChatGPT: current thread/task context relevant to the conversation.
- Telegram: alerts, short conversations, urgent approvals.

The canonical store keeps everything regardless of presentation.

## Memory sync

All channels feed the same Memory & Preference Engine.

A memory extracted from Telegram must be available in the Owner Console and ChatGPT bridge.

A decision made in ChatGPT must be visible to Telegram and Owner Console.

Do not build channel-specific memory silos.

## Security

Every channel must authenticate to the same CoOperative identity/authorization layer.

Requirements:

- explicit owner/channel linking;
- least-privilege channel permissions;
- revocable channel sessions/tokens;
- approval actions tied to verified owner identity;
- audit trail of source channel;
- no raw secrets in message history.

## Cost control

Do not resend the entire omnichannel transcript to an AI model on every turn.

Use:

- selective memory retrieval;
- conversation summarization;
- linked task state;
- structured decisions/policies;
- targeted relevant-message windows.

The canonical store can be complete while model context stays small.

## Success criteria

The omnichannel system is working when:

1. a task started in ChatGPT can be continued in Owner Console;
2. a decision made in Telegram updates the same CoOperative task;
3. all channels use the same current owner memory/policies;
4. message/task history is not duplicated into separate silos;
5. changing AI providers does not lose continuity;
6. channel outages do not lose canonical state;
7. approvals are identity-verified and auditable;
8. the owner does not need to re-explain stable context when switching channels.
