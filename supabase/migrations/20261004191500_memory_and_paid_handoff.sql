create table if not exists public.cooperative_memories (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  scope text not null check (scope in ('owner','organization','project','workflow','conversation')),
  scope_ref text,
  memory_type text not null check (memory_type in ('preference','policy','decision','goal','fact','lesson','open_question')),
  content text not null,
  normalized_key text not null,
  status text not null default 'active' check (status in ('active','candidate','superseded','ignored')),
  confidence numeric(4,3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  explicit_owner_statement boolean not null default false,
  source_conversation_id uuid references public.local_ai_conversations(id) on delete set null,
  source_job_id uuid references public.text_inference_jobs(id) on delete set null,
  extracted_by text not null,
  source_provider text,
  source_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cooperative_memories_owner_status_idx
  on public.cooperative_memories(owner_ref,status,last_confirmed_at desc);

create index if not exists cooperative_memories_owner_scope_idx
  on public.cooperative_memories(owner_ref,scope,scope_ref,memory_type);

create unique index if not exists cooperative_memories_active_key_uidx
  on public.cooperative_memories(owner_ref,scope,coalesce(scope_ref,''),memory_type,normalized_key)
  where status='active';

alter table public.cooperative_memories enable row level security;

alter table public.text_inference_jobs
  add column if not exists support_packet jsonb,
  add column if not exists support_analyzed_at timestamptz,
  add column if not exists paid_prompt_draft text,
  add column if not exists paid_prompt_reason text;
