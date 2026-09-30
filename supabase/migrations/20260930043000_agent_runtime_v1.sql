create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  agent_key text not null check (agent_key in ('repo-engineer','project-memory','debugger','verifier')),
  repo_key text not null check (repo_key in ('cooperative','creatorhub')),
  mode text not null check (mode in ('inspect','prepare_change','update_memory','verify')),
  objective text not null check (char_length(objective) between 1 and 12000),
  requested_profile text not null default 'fast' check (requested_profile in ('fast','quality')),
  status text not null default 'queued' check (status in ('queued','running','waiting_llm','needs_approval','completed','failed','cancelled')),
  worker_id text,
  branch_name text,
  result jsonb,
  error text,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  owner_ref text not null,
  kind text not null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_tasks enable row level security;
alter table public.agent_task_events enable row level security;
revoke all on table public.agent_tasks from anon, authenticated;
revoke all on table public.agent_task_events from anon, authenticated;
grant all on table public.agent_tasks to service_role;
grant all on table public.agent_task_events to service_role;

create index if not exists agent_tasks_status_created_idx
  on public.agent_tasks(status, created_at);

create index if not exists agent_tasks_owner_created_idx
  on public.agent_tasks(owner_ref, created_at desc);

create index if not exists agent_task_events_task_created_idx
  on public.agent_task_events(task_id, created_at);

alter table public.text_inference_jobs
  add column if not exists agent_task_id uuid references public.agent_tasks(id) on delete set null;

create or replace function public.claim_next_agent_task(p_worker_id text)
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.agent_tasks
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous agent worker lease expired; task was requeued.')
  where status in ('running','waiting_llm')
    and claimed_at < now() - interval '60 minutes';

  select id into v_id
  from public.agent_tasks
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.agent_tasks
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'local-repo-agent'), 160),
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id;

  return query select * from public.agent_tasks where id = v_id;
end;
$$;

revoke all on function public.claim_next_agent_task(text) from public, anon, authenticated;
grant execute on function public.claim_next_agent_task(text) to service_role;
