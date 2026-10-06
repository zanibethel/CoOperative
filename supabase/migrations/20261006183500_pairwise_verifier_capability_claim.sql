
create or replace function public.claim_next_text_inference_job(
  p_worker_id text,
  p_node_id text default null::text
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

  select j.id into v_id
  from public.text_inference_jobs j
  where j.status = 'queued'
    and j.personal_use = false
    and (j.target_node_id is null or j.target_node_id = p_node_id)
    and (
      j.capability <> 'media-judge'
      or exists (
        select 1
        from public.unison_nodes n
        where n.id = p_node_id
          and (
            (
              j.routing_mode = 'semantic-pairwise-v1'
              and coalesce(n.capabilities, '[]'::jsonb)
                @> '["semantic_media_pairwise_v1"]'::jsonb
            )
            or (
              j.routing_mode <> 'semantic-pairwise-v1'
              and coalesce(n.capabilities, '[]'::jsonb)
                @> '["semantic_media_judge_v1"]'::jsonb
            )
          )
      )
    )
    and (
      j.preferred_node_id is null
      or j.preferred_node_id = p_node_id
      or j.created_at < now() - interval '15 seconds'
    )
  order by
    case
      when j.preferred_node_id = p_node_id then 0
      when j.preferred_node_id is null then 1
      else 2
    end,
    j.created_at asc
  for update of j skip locked
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

revoke all on function public.claim_next_text_inference_job(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_next_text_inference_job(text, text)
  to service_role;
