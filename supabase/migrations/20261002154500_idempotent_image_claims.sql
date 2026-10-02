create or replace function public.claim_next_image_inference_job(p_worker_id text)
returns setof public.inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_worker_id text := left(coalesce(p_worker_id, 'local-worker'), 160);
begin
  update public.inference_jobs
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous worker lease expired; job was requeued.')
  where status = 'running'
    and claimed_at < now() - interval '45 minutes';

  -- Make claiming idempotent for a worker. If the HTTP response to a successful
  -- claim is lost, the same worker gets that lease back instead of orphaning it
  -- and accidentally claiming a second job.
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

  return query select * from public.inference_jobs where id = v_id;
end;
$$;

revoke all on function public.claim_next_image_inference_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_image_inference_job(text) to service_role;
