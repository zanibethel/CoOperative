create table if not exists public.media_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','cancelled')),
  owner_ref text not null,
  conversation_id uuid references public.local_ai_conversations(id) on delete cascade,
  kind text not null check (kind in ('image','video')),
  prompt text not null check (char_length(prompt) between 1 and 12000),
  provider text not null,
  model text not null,
  model_mixer jsonb,
  request_max_spend_microusd bigint
    check (
      request_max_spend_microusd is null
      or request_max_spend_microusd between 0 and 100000000
    ),
  sandbox_name text,
  result_url text,
  result_text text,
  usage jsonb,
  error text,
  started_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.media_generation_jobs enable row level security;
revoke all on table public.media_generation_jobs from anon, authenticated;
grant all on table public.media_generation_jobs to service_role;

create index if not exists media_generation_jobs_owner_created_idx
  on public.media_generation_jobs(owner_ref, created_at desc);

create index if not exists media_generation_jobs_status_created_idx
  on public.media_generation_jobs(status, created_at);
