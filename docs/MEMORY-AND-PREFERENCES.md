# CoOperative Memory & Preference Engine

## Purpose

CoOperative should continuously preserve the durable meaning of owner and business conversations so the owner does not have to repeatedly explain goals, preferences, operating principles, prior decisions, or the reasoning behind them.

Memory belongs to CoOperative, not to any one AI provider.

A model may change. The owner's context should not.

## Core rule

> Conversations are evidence. Structured memory is the durable operating context.

Do not rely on a model's hidden conversation memory as the source of truth.

CoOperative should preserve both:

1. **conversation history** — what was actually said;
2. **structured memory** — the durable facts, preferences, policies, decisions, lessons, goals, and unresolved questions extracted from that conversation.

## What should become durable memory

Examples include:

- owner goals;
- business goals;
- communication/style preferences;
- technical preferences;
- cost philosophy;
- approval preferences;
- risk tolerance by action type;
- recurring frustrations;
- product principles;
- architectural decisions;
- accepted/rejected approaches;
- reasons behind important decisions;
- operating policies;
- customer-service philosophy;
- pricing/margin rules;
- current priorities;
- lessons learned;
- recurring constraints;
- long-term ideas;
- unresolved questions worth revisiting.

Do not promote every sentence into durable memory.

## Memory classes

### 1. Preference
How the owner wants AI or the platform to behave.

### 2. Policy
A rule CoOperative should enforce.

### 3. Decision
A choice already made.

### 4. Goal
An outcome the owner/business is pursuing.

### 5. Fact / Context
Durable factual context required to make future decisions correctly.

### 6. Lesson / Revelation
A new understanding discovered through conversation or execution.

### 7. Open Question
Something intentionally unresolved that should remain visible for later work.

## Memory scope

Every memory must have an explicit scope, for example:

- `owner`
- `organization`
- `project`
- `workflow`
- `conversation`

Tenant data must never leak across organization scopes.

## Provenance

Every structured memory should keep provenance:

- source conversation/task;
- source message/decision;
- created_at;
- last_confirmed_at;
- who/what extracted it;
- confidence;
- whether the owner explicitly confirmed it.

The system must be able to answer:

> Why do you think I prefer this?

without inventing an explanation.

## Memory lifecycle

```text
conversation
  -> candidate memory extraction
  -> classify scope/type
  -> deduplicate against existing memory
  -> detect contradiction/change
  -> assign confidence
  -> save or request confirmation when important
  -> use in future context retrieval
  -> reinforce/update when reconfirmed
  -> supersede when owner changes direction
  -> retain provenance/history
```

Do not silently overwrite an important prior policy. Mark it superseded and preserve the decision history.

## Contradictions and changing preferences

People change their minds.

If a new conversation conflicts with existing memory:

1. identify the conflict;
2. prefer the newest explicit owner statement for future behavior;
3. preserve the prior value as historical/superseded;
4. ask for confirmation when the conflict would materially change consequential behavior.

## Conversation storage

Owner Console conversations should be durably stored with:

- thread;
- messages;
- participants;
- linked tasks;
- linked decisions;
- linked artifacts;
- generated memory candidates;
- final structured memories created from the thread.

Raw conversation storage and structured memory are separate concerns.

## Retrieval

Before responding or creating a task, the AI advisor should retrieve only relevant memories.

Do not inject the entire memory store into every prompt.

Suggested retrieval context:

- current owner preferences;
- relevant organization policies;
- related prior decisions;
- relevant goals;
- project/workflow context;
- unresolved related questions.

This preserves continuity while controlling cost and token usage.

## User control

The owner should be able to:

- inspect active memories;
- search them;
- edit/correct them;
- mark something temporary;
- supersede an old preference;
- pin an important principle;
- request that a memory not be used;
- see provenance;
- distinguish personal owner memory from business-specific memory.

Normal use should not require manual memory management.

## Privacy and sensitive information

Do not automatically convert highly sensitive information into broad reusable memory unless it is genuinely necessary and authorized for the product experience.

Prefer the minimum useful representation.

Do not use private customer/employee information as generalized platform learning.

## Relationship to playbooks

Memory answers:

> What matters to this owner/business?

Playbooks answer:

> How does CoOperative know how to perform this class of work?

Memory should influence playbook selection and approval rules without duplicating procedural logic.

## Relationship to AI training

Raw private conversations are not automatically training data.

Potential learning pipeline:

```text
conversation / decision / outcome
  -> structured memory or generalized pattern
  -> remove tenant-specific/private data
  -> validate
  -> add to approved evaluation/training corpus
```

## External conversation sources

The long-term system may ingest owner-authorized context from:

- CoOperative Owner Console;
- a ChatGPT/CoOperative connector;
- Telegram;
- approved files/docs;
- operative task results.

All sources should feed the same governed Memory & Preference Engine.

External chat history should only be imported when the owner explicitly connects or provides it.

## Success criteria

The memory system is working when:

1. the owner does not repeatedly explain stable preferences;
2. AI responses reflect current owner/business policies;
3. prior decisions are easy to recover;
4. changed preferences supersede old ones correctly;
5. context survives model/provider changes;
6. retrieval is selective and cost-efficient;
7. the owner can inspect/correct what CoOperative believes;
8. memories have provenance;
9. tenant/private information stays isolated;
10. useful revelations continuously improve future conversations and decisions.
