create table if not exists public.local_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  title text not null default 'New chat',
  profile text not null default 'fast' check (profile in ('fast','quality')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.local_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.local_ai_conversations(id) on delete cascade,
  owner_ref text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  job_id uuid references public.text_inference_jobs(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.text_inference_jobs
  add column if not exists conversation_id uuid references public.local_ai_conversations(id) on delete set null;

alter table public.local_ai_conversations enable row level security;
alter table public.local_ai_messages enable row level security;

revoke all on table public.local_ai_conversations from anon, authenticated;
revoke all on table public.local_ai_messages from anon, authenticated;
grant all on table public.local_ai_conversations to service_role;
grant all on table public.local_ai_messages to service_role;

create index if not exists local_ai_conversations_owner_updated_idx
  on public.local_ai_conversations(owner_ref, updated_at desc);

create index if not exists local_ai_messages_conversation_created_idx
  on public.local_ai_messages(conversation_id, created_at);

create unique index if not exists local_ai_messages_job_role_unique_idx
  on public.local_ai_messages(job_id, role)
  where job_id is not null;
