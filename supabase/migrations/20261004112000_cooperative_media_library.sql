create table if not exists public.cooperative_media_library (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  source_job_id uuid references public.media_generation_jobs(id) on delete set null,
  kind text not null check (kind in ('image','video')),
  storage_path text not null,
  mime_type text not null,
  file_name text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  provider text,
  model text,
  prompt text,
  created_at timestamptz not null default now()
);

create index if not exists cooperative_media_library_owner_created_idx
  on public.cooperative_media_library (owner_ref, created_at desc);

create unique index if not exists cooperative_media_library_owner_source_job_uidx
  on public.cooperative_media_library (owner_ref, source_job_id)
  where source_job_id is not null;

alter table public.cooperative_media_library enable row level security;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cooperative-media-library',
  'cooperative-media-library',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
