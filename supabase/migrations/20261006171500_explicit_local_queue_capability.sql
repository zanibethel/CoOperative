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

  select j.id into v_id
  from public.inference_jobs j
  where j.status = 'queued'
    and (
      j.content_mode <> 'adult_explicit'
      or exists (
        select 1
        from public.unison_nodes n
        where n.id = p_worker_id
          and n.state <> 'paused'
          and n.last_seen_at >= now() - interval '2 minutes'
          and n.capabilities @> '["adult_explicit_text_to_image"]'::jsonb
      )
    )
  order by j.created_at asc
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

revoke all on function public.claim_next_image_inference_job(text)
from public, anon, authenticated;
grant execute on function public.claim_next_image_inference_job(text)
to service_role;
