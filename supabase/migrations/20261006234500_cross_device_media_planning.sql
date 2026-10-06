
create or replace function public.claim_next_media_planning_text_inference_job(
  p_worker_id text,
  p_node_id text
)
returns setof public.text_inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_node_id is null or btrim(p_node_id) = '' then
    return;
  end if;

  update public.text_inference_jobs
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous media-planning worker lease expired; job was requeued.')
  where status = 'running'
    and personal_use = false
    and task_class = 'media-planning'
    and routing_mode = 'cross-device-media-planning-v1'
    and target_node_id = p_node_id
    and claimed_at < now() - interval '20 minutes';

  if not exists (
    select 1
    from public.unison_nodes n
    where n.id = p_node_id
      and coalesce(n.capabilities, '[]'::jsonb)
        @> '["text_generation","media_prompt_planning_v1"]'::jsonb
      and coalesce(n.policy ->> 'allowText', 'true') <> 'false'
      and n.state <> 'paused'
  ) then
    return;
  end if;

  select j.id into v_id
  from public.text_inference_jobs j
  where j.status = 'queued'
    and j.personal_use = false
    and j.capability = 'text'
    and j.task_class = 'media-planning'
    and j.routing_mode = 'cross-device-media-planning-v1'
    and j.target_node_id = p_node_id
  order by j.created_at asc
  for update of j skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.text_inference_jobs
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'media-planning-worker'), 160),
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

revoke all on function public.claim_next_media_planning_text_inference_job(text,text)
  from public, anon, authenticated;
grant execute on function public.claim_next_media_planning_text_inference_job(text,text)
  to service_role;

create index if not exists text_inference_jobs_media_planning_target_idx
  on public.text_inference_jobs(target_node_id, created_at)
  where status = 'queued'
    and personal_use = false
    and task_class = 'media-planning'
    and routing_mode = 'cross-device-media-planning-v1';
