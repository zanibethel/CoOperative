create or replace function public.claim_next_agent_task_for_owner(
  p_worker_id text,
  p_owner_ref text
)
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.agent_tasks
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous agent worker lease expired; task was requeued.')
  where owner_ref = p_owner_ref
    and status in ('running','waiting_llm')
    and claimed_at < now() - interval '60 minutes';

  select id into v_id
  from public.agent_tasks
  where owner_ref = p_owner_ref
    and status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.agent_tasks
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'owned-repo-agent'), 160),
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id
    and owner_ref = p_owner_ref;

  return query
    select * from public.agent_tasks where id = v_id;
end;
$$;

revoke all on function public.claim_next_agent_task_for_owner(text,text)
  from public, anon, authenticated;
grant execute on function public.claim_next_agent_task_for_owner(text,text)
  to service_role;
