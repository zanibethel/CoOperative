alter table public.text_inference_jobs
  add column if not exists routing_preference text not null default 'default'
    check (routing_preference in ('default','prefer-owned','require-node')),
  add column if not exists preferred_node_id text references public.unison_nodes(id) on delete set null,
  add column if not exists target_node_id text references public.unison_nodes(id) on delete set null;

create index if not exists text_inference_jobs_target_status_idx
  on public.text_inference_jobs(target_node_id, status, created_at);

create index if not exists text_inference_jobs_preferred_status_idx
  on public.text_inference_jobs(preferred_node_id, status, created_at);

drop function if exists public.claim_next_text_inference_job(text);

create function public.claim_next_text_inference_job(
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
    and claimed_at < now() - interval '20 minutes';

  select id into v_id
  from public.text_inference_jobs
  where status = 'queued'
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
  select *
  from public.text_inference_jobs
  where id = v_id;
end;
$$;

revoke all on function public.claim_next_text_inference_job(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_next_text_inference_job(text, text)
  to service_role;
