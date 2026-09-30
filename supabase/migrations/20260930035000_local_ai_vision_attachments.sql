create table if not exists public.local_ai_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  conversation_id uuid references public.local_ai_conversations(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3145728),
  created_at timestamptz not null default now()
);

alter table public.local_ai_attachments enable row level security;
revoke all on table public.local_ai_attachments from anon, authenticated;
grant all on table public.local_ai_attachments to service_role;

alter table public.local_ai_messages
  add column if not exists attachment_ids uuid[] not null default '{}'::uuid[];

alter table public.text_inference_jobs
  add column if not exists attachment_ids uuid[] not null default '{}'::uuid[],
  add column if not exists capability text not null default 'text';

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_capability_check,
  add constraint text_inference_jobs_capability_check
    check (capability in ('text','vision'));

create index if not exists local_ai_attachments_owner_created_idx
  on public.local_ai_attachments(owner_ref, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'local-ai-attachments',
  'local-ai-attachments',
  false,
  3145728,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
