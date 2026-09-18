-- CoOperative Cloud Operative schema v0.2
-- PROPOSED MIGRATION — NOT YET APPLIED.
-- This file is prepared for owner review under the database-migration owner gate
-- (see HERMES.md "Hermes MUST STOP for owner approval before ... database migrations").
-- Do not run `supabase db push` / apply this in any environment until the owner approves.
--
-- Implements the Cloud Operative primitives described in docs/CLOUD-OPERATIVE.md,
-- docs/OMNICHANNEL-CONVERSATIONS.md, and docs/MEMORY-AND-PREFERENCES.md:
--   - canonical conversations/messages (Owner Console primary, Telegram/ChatGPT secondary)
--   - operative tasks + state machine + audit trail
--   - decisions / Decision Briefs + approve/reject/modify
--   - durable structured memory (owner/org scoped, provenance-aware)
--   - cost ledger (per task, per executor)
--
-- All tables are owner-scoped through organizations, mirroring the RLS pattern
-- already deployed in schema-v0.1.sql.

-- ---------------------------------------------------------------------------
-- 1. Canonical conversations (Owner Console primary, Telegram/ChatGPT secondary)
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  primary_channel text not null default 'owner-console'
    check (primary_channel in ('owner-console', 'telegram', 'chatgpt')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_organization_id_idx
  on public.conversations(organization_id);
create index if not exists conversations_owner_user_id_idx
  on public.conversations(owner_user_id);

-- One canonical event format per docs/OMNICHANNEL-CONVERSATIONS.md "Channel adapters":
-- { conversation_id, actor_id, channel, timestamp, message_type, text, attachments, reply_to, linked_task_id }
create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id text not null,
  actor_type text not null default 'owner'
    check (actor_type in ('owner', 'advisor', 'system')),
  channel text not null
    check (channel in ('owner-console', 'telegram', 'chatgpt', 'system')),
  message_type text not null default 'text'
    check (message_type in ('text', 'decision_brief', 'approval_response', 'task_update', 'system_note')),
  text text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  reply_to_message_id uuid references public.conversation_messages(id) on delete set null,
  linked_task_id uuid,
  linked_decision_id uuid,
  model_provider text,
  model_name text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint conversation_messages_idempotency_unique unique (conversation_id, idempotency_key)
);

create index if not exists conversation_messages_conversation_id_idx
  on public.conversation_messages(conversation_id, created_at);
create index if not exists conversation_messages_organization_id_idx
  on public.conversation_messages(organization_id);
create index if not exists conversation_messages_linked_task_id_idx
  on public.conversation_messages(linked_task_id);

-- ---------------------------------------------------------------------------
-- 2. Operative tasks + state machine + audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.operative_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  source_channel text not null default 'owner-console'
    check (source_channel in ('owner-console', 'telegram', 'chatgpt', 'admin', 'scheduled', 'github-issue')),
  title text not null check (char_length(title) between 2 and 200),
  description text not null default '',
  status text not null default 'queued'
    check (status in (
      'queued', 'planning', 'awaiting_approval', 'executing', 'verifying',
      'completed', 'blocked', 'failed', 'rolled_back', 'cancelled'
    )),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  requires_owner_approval boolean not null default false,
  playbook_key text,
  selected_executor text
    check (selected_executor in (
      'deterministic-code', 'connected-chatgpt', 'native-capability',
      'hermes-cloud-operative', 'external-ai-provider'
    )),
  max_spend_cents integer not null default 0 check (max_spend_cents >= 0),
  actual_spend_cents integer not null default 0 check (actual_spend_cents >= 0),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operative_tasks_organization_id_idx
  on public.operative_tasks(organization_id);
create index if not exists operative_tasks_conversation_id_idx
  on public.operative_tasks(conversation_id);
create index if not exists operative_tasks_status_idx
  on public.operative_tasks(status);
create index if not exists operative_tasks_created_by_idx
  on public.operative_tasks(created_by);

-- Every task_event is one audit-trail entry (state transition, executor action,
-- cost increment, etc). Append-only.
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operative_tasks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'created', 'status_changed', 'executor_selected', 'playbook_selected',
      'sandbox_created', 'sandbox_stopped', 'ai_call', 'cost_recorded',
      'artifact_saved', 'approval_requested', 'approval_resolved',
      'error', 'note'
    )),
  from_status text,
  to_status text,
  actor text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_events_task_id_idx
  on public.task_events(task_id, created_at);
create index if not exists task_events_organization_id_idx
  on public.task_events(organization_id);

-- ---------------------------------------------------------------------------
-- 3. Decisions / Decision Briefs + approve/reject/modify
-- ---------------------------------------------------------------------------

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.operative_tasks(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- Decision Brief contract per docs/CLOUD-OPERATIVE.md:
  -- what/why/if-approved/if-declined/cost/impact/risk/scopes/rollback/recommendation
  proposal_summary text not null,
  rationale text not null default '',
  expected_outcome_if_approved text not null default '',
  expected_outcome_if_declined text not null default '',
  estimated_cost_cents integer not null default 0 check (estimated_cost_cents >= 0),
  estimated_savings_cents integer,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  required_scopes jsonb not null default '[]'::jsonb check (jsonb_typeof(required_scopes) = 'array'),
  rollback_plan text not null default '',
  recommended_action text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'modified', 'expired', 'superseded')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_via_channel text
    check (resolved_via_channel in ('owner-console', 'telegram', 'chatgpt')),
  resolution_note text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint decisions_idempotency_unique unique (task_id, idempotency_key)
);

create index if not exists decisions_organization_id_idx
  on public.decisions(organization_id);
create index if not exists decisions_task_id_idx
  on public.decisions(task_id);
create index if not exists decisions_status_idx
  on public.decisions(status);

-- ---------------------------------------------------------------------------
-- 4. Cost ledger
-- ---------------------------------------------------------------------------

create table if not exists public.cost_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.operative_tasks(id) on delete set null,
  executor text not null
    check (executor in (
      'deterministic-code', 'connected-chatgpt', 'native-capability',
      'hermes-cloud-operative', 'external-ai-provider', 'vercel-sandbox'
    )),
  cost_category text not null
    check (cost_category in ('ai-tokens', 'sandbox-compute', 'storage', 'network', 'other')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  is_marginal_cost boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cost_ledger_entries_organization_id_idx
  on public.cost_ledger_entries(organization_id);
create index if not exists cost_ledger_entries_task_id_idx
  on public.cost_ledger_entries(task_id);

-- ---------------------------------------------------------------------------
-- 5. Durable structured memory (docs/MEMORY-AND-PREFERENCES.md)
-- ---------------------------------------------------------------------------

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null
    check (scope in ('owner', 'organization', 'project', 'workflow', 'conversation')),
  memory_class text not null
    check (memory_class in ('preference', 'policy', 'decision', 'goal', 'fact', 'lesson', 'open_question')),
  content text not null check (char_length(content) between 1 and 2000),
  -- Provenance: never invent an explanation for "why do you think I prefer this".
  source_conversation_id uuid references public.conversations(id) on delete set null,
  source_message_id uuid references public.conversation_messages(id) on delete set null,
  source_task_id uuid references public.operative_tasks(id) on delete set null,
  extracted_by text not null default 'system'
    check (extracted_by in ('system', 'owner-confirmed', 'ai-advisor')),
  confidence numeric(3,2) not null default 0.50 check (confidence between 0 and 1),
  owner_confirmed boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'retired')),
  supersedes_memory_id uuid references public.memories(id) on delete set null,
  pinned boolean not null default false,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_organization_id_idx
  on public.memories(organization_id);
create index if not exists memories_scope_class_idx
  on public.memories(organization_id, scope, memory_class)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 6. Channel identity mapping (Telegram/ChatGPT -> CoOperative owner identity)
-- ---------------------------------------------------------------------------

create table if not exists public.channel_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'chatgpt')),
  -- external_identity_ref is a NAME/reference (e.g. Telegram numeric chat id as text,
  -- or a ChatGPT connector session reference) — never a secret/token value.
  external_identity_ref text not null,
  allow_listed boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint channel_identities_unique unique (channel, external_identity_ref)
);

create index if not exists channel_identities_organization_id_idx
  on public.channel_identities(organization_id);
create index if not exists channel_identities_owner_user_id_idx
  on public.channel_identities(owner_user_id);

-- ---------------------------------------------------------------------------
-- RLS: owner-scoped, mirrors schema-v0.1.sql pattern.
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.operative_tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.decisions enable row level security;
alter table public.cost_ledger_entries enable row level security;
alter table public.memories enable row level security;
alter table public.channel_identities enable row level security;

revoke all on public.conversations from anon;
revoke all on public.conversation_messages from anon;
revoke all on public.operative_tasks from anon;
revoke all on public.task_events from anon;
revoke all on public.decisions from anon;
revoke all on public.cost_ledger_entries from anon;
revoke all on public.memories from anon;
revoke all on public.channel_identities from anon;

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversation_messages to authenticated;
grant select, insert, update, delete on public.operative_tasks to authenticated;
grant select, insert on public.task_events to authenticated;
grant select, insert, update on public.decisions to authenticated;
grant select, insert on public.cost_ledger_entries to authenticated;
grant select, insert, update on public.memories to authenticated;
grant select, insert, update on public.channel_identities to authenticated;

-- conversations
create policy "owners_select_conversations"
on public.conversations for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_conversations"
on public.conversations for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_user_id = (select auth.uid())
  )
);

create policy "owners_update_conversations"
on public.conversations for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_conversations"
on public.conversations for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- conversation_messages
create policy "owners_select_conversation_messages"
on public.conversation_messages for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_conversation_messages"
on public.conversation_messages for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_update_conversation_messages"
on public.conversation_messages for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_conversation_messages"
on public.conversation_messages for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- operative_tasks
create policy "owners_select_operative_tasks"
on public.operative_tasks for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_operative_tasks"
on public.operative_tasks for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_user_id = (select auth.uid())
  )
);

create policy "owners_update_operative_tasks"
on public.operative_tasks for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_operative_tasks"
on public.operative_tasks for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- task_events (append-only: select + insert, no update/delete policy granted)
create policy "owners_select_task_events"
on public.task_events for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_task_events"
on public.task_events for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- decisions
create policy "owners_select_decisions"
on public.decisions for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_decisions"
on public.decisions for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_update_decisions"
on public.decisions for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- cost_ledger_entries (append-only)
create policy "owners_select_cost_ledger_entries"
on public.cost_ledger_entries for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_cost_ledger_entries"
on public.cost_ledger_entries for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- memories
create policy "owners_select_memories"
on public.memories for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_memories"
on public.memories for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_update_memories"
on public.memories for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

-- channel_identities
create policy "owners_select_channel_identities"
on public.channel_identities for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_channel_identities"
on public.channel_identities for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_user_id = (select auth.uid())
  )
);

create policy "owners_update_channel_identities"
on public.channel_identities for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));
