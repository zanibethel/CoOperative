create table if not exists public.text_inference_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  client_owner_ref text not null,
  messages jsonb not null check (jsonb_typeof(messages) = 'array'),
  profile text not null default 'fast' check (profile in ('fast','quality')),
  max_tokens integer not null default 768 check (max_tokens between 16 and 4096),
  temperature numeric not null default 0.2 check (temperature >= 0 and temperature <= 2),
  result_text text,
  result_model text,
  result_provider text,
  prompt_tokens integer,
  output_tokens integer,
  latency_ms integer,
  worker_id text,
  error text,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.text_inference_jobs enable row level security;
revoke all on table public.text_inference_jobs from anon, authenticated;
grant all on table public.text_inference_jobs to service_role;

create index if not exists text_inference_jobs_status_created_idx
  on public.text_inference_jobs(status, created_at);

create or replace function public.claim_next_text_inference_job(p_worker_id text)
returns setof public.text_inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.text_inference_jobs
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous worker lease expired; job was requeued.')
  where status = 'running'
    and claimed_at < now() - interval '20 minutes';

  select id into v_id
  from public.text_inference_jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.text_inference_jobs
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'local-text-worker'), 160),
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id;

  return query select * from public.text_inference_jobs where id = v_id;
end;
$$;

revoke all on function public.claim_next_text_inference_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_text_inference_job(text) to service_role;
