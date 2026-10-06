alter table public.inference_jobs
  add column if not exists pipeline_mode text not null default 'single-pass',
  add column if not exists pipeline_trace jsonb not null default '{}'::jsonb,
  add column if not exists required_capabilities jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inference_jobs_pipeline_mode_check'
      and conrelid = 'public.inference_jobs'::regclass
  ) then
    alter table public.inference_jobs
      add constraint inference_jobs_pipeline_mode_check
      check (pipeline_mode in ('single-pass', 'quality-v1'));
  end if;
end
$$;

create index if not exists inference_jobs_required_capabilities_gin_idx
  on public.inference_jobs using gin (required_capabilities);

create or replace function public.claim_next_image_inference_job_v2(
  p_worker_id text,
  p_capabilities jsonb default '[]'::jsonb
)
returns setof public.inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_worker_id text := left(coalesce(p_worker_id, 'local-worker'), 160);
  v_capabilities jsonb := case
    when jsonb_typeof(coalesce(p_capabilities, '[]'::jsonb)) = 'array'
      then coalesce(p_capabilities, '[]'::jsonb)
    else '[]'::jsonb
  end;
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
  where status = 'running'
    and worker_id = v_worker_id
  order by claimed_at asc
  for update skip locked
  limit 1;

  if v_id is not null then
    update public.inference_jobs
    set claimed_at = now(),
        updated_at = now()
    where id = v_id;

    return query
      select * from public.inference_jobs where id = v_id;
    return;
  end if;

  select id into v_id
  from public.inference_jobs
  where status = 'queued'
    and coalesce(required_capabilities, '[]'::jsonb) <@ v_capabilities
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.inference_jobs
  set status = 'running',
      worker_id = v_worker_id,
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id;

  return query
    select * from public.inference_jobs where id = v_id;
end;
$$;

revoke all on function public.claim_next_image_inference_job_v2(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_next_image_inference_job_v2(text, jsonb)
  to service_role;

comment on column public.inference_jobs.pipeline_mode is
  'Requested owned/local media pipeline. single-pass preserves legacy behavior; quality-v1 enables the first composable quality pipeline on capable workers.';

comment on column public.inference_jobs.pipeline_trace is
  'Structured stage trace returned by the owned/local media worker for composable media execution.';

comment on column public.inference_jobs.required_capabilities is
  'JSON array of Unison capability strings that a worker must advertise before claiming this image job.';
