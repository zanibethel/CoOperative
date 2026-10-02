create or replace function public.claim_next_text_inference_job(
  p_worker_id text,
  p_node_id text default null
)
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
    and personal_use = false
    and claimed_at < now() - interval '20 minutes';

  select id into v_id
  from public.text_inference_jobs
  where status = 'queued'
    and personal_use = false
    and (target_node_id is null or target_node_id = p_node_id)
    and (
      preferred_node_id is null
      or preferred_node_id = p_node_id
      or created_at < now() - interval '15 seconds'
    )
  order by
    case
      when preferred_node_id = p_node_id then 0
      when preferred_node_id is null then 1
      else 2
    end,
    created_at asc
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

  return query
  select * from public.text_inference_jobs where id = v_id;
end;
$$;

revoke all on function public.claim_next_text_inference_job(text,text)
  from public, anon, authenticated;
grant execute on function public.claim_next_text_inference_job(text,text)
  to service_role;
