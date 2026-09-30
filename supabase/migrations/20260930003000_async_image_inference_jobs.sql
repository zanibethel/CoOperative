create table if not exists public.inference_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'image' check (kind in ('image')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  client_owner_ref text not null,
  prompt text not null check (char_length(prompt) between 1 and 6000),
  aspect_ratio text not null default '4:5' check (aspect_ratio in ('1:1','4:5','3:2','16:9','9:16')),
  profile text not null default 'fast' check (profile in ('fast','quality')),
  negative_prompt text,
  steps integer,
  guidance_scale numeric,
  strength numeric,
  reference_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(reference_paths) = 'array'),
  result_path text,
  result_model text,
  result_provider text,
  references_used integer not null default 0 check (references_used >= 0),
  latency_ms integer,
  worker_id text,
  error text,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inference_jobs enable row level security;
revoke all on table public.inference_jobs from anon, authenticated;
grant all on table public.inference_jobs to service_role;

create index if not exists inference_jobs_status_created_idx
  on public.inference_jobs(status, created_at);

create or replace function public.claim_next_image_inference_job(p_worker_id text)
returns setof public.inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.inference_jobs
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous worker lease expired; job was requeued.')
  where status = 'running'
    and claimed_at < now() - interval '45 minutes';

  select id into v_id
  from public.inference_jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.inference_jobs
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'local-worker'), 160),
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id;

  return query select * from public.inference_jobs where id = v_id;
end;
$$;

revoke all on function public.claim_next_image_inference_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_image_inference_job(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inference-job-assets',
  'inference-job-assets',
  false,
  12582912,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
