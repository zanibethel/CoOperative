insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cooperative-ai-context',
  'cooperative-ai-context',
  false,
  2097152,
  array['text/markdown','text/plain']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.cooperative_context_documents (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  document_kind text not null check (
    document_kind in ('runtime_context','outcome_snapshot','reasoning_review')
  ),
  storage_path text not null,
  source_job_id uuid references public.text_inference_jobs(id) on delete set null,
  source_conversation_id uuid references public.local_ai_conversations(id) on delete set null,
  generated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists cooperative_context_documents_path_uidx
  on public.cooperative_context_documents(owner_ref, storage_path);

create index if not exists cooperative_context_documents_owner_kind_idx
  on public.cooperative_context_documents(owner_ref, document_kind, generated_at desc);

alter table public.cooperative_context_documents enable row level security;

create table if not exists public.cooperative_reasoning_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  period_start timestamptz,
  period_end timestamptz not null default now(),
  evidence_job_count integer not null default 0,
  status text not null default 'advisory' check (
    status in ('advisory','approved','rejected','superseded')
  ),
  summary text not null default '',
  reasoning_guidance jsonb not null default '[]'::jsonb,
  codebase_candidates jsonb not null default '[]'::jsonb,
  routing_lessons jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists cooperative_reasoning_reviews_owner_created_idx
  on public.cooperative_reasoning_reviews(owner_ref, created_at desc);

alter table public.cooperative_reasoning_reviews enable row level security;

alter table public.text_inference_jobs
  add column if not exists context_document_path text,
  add column if not exists context_document_generated_at timestamptz;
