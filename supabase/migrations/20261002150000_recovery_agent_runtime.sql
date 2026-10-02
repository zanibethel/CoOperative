create table if not exists public.recovery_incidents (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  conversation_id uuid references public.local_ai_conversations(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('text','media','connector','runtime')),
  source_job_id text,
  status text not null default 'diagnosing'
    check (status in (
      'diagnosing',
      'repairing',
      'waiting_user',
      'retrying',
      'completed',
      'failed',
      'cancelled'
    )),
  error_class text not null,
  error_excerpt text,
  current_message text not null,
  continuation_prompt text,
  requires_user_action boolean not null default false,
  automatic_retry boolean not null default false,
  agent_task_id uuid references public.agent_tasks(id) on delete set null,
  retry_job_id uuid,
  attempt_count integer not null default 0
    check (attempt_count between 0 and 8),
  resolution_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.recovery_incidents enable row level security;
revoke all on table public.recovery_incidents from anon, authenticated;
grant all on table public.recovery_incidents to service_role;

create table if not exists public.recovery_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.recovery_incidents(id) on delete cascade,
  owner_ref text not null,
  kind text not null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.recovery_events enable row level security;
revoke all on table public.recovery_events from anon, authenticated;
grant all on table public.recovery_events to service_role;

create index if not exists recovery_incidents_owner_created_idx
  on public.recovery_incidents(owner_ref, created_at desc);

create index if not exists recovery_incidents_conversation_created_idx
  on public.recovery_incidents(conversation_id, created_at desc);

create index if not exists recovery_events_incident_created_idx
  on public.recovery_events(incident_id, created_at);

create unique index if not exists recovery_incidents_active_source_idx
  on public.recovery_incidents(owner_ref, source_kind, source_job_id)
  where source_job_id is not null
    and status in ('diagnosing','repairing','waiting_user','retrying');
