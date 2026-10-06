create or replace function public.reserve_agent_workflow_node_budget(
  p_owner_ref text,
  p_workflow_id uuid,
  p_node_id uuid,
  p_amount_microusd bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow public.agent_workflows%rowtype;
  v_node public.agent_workflow_nodes%rowtype;
begin
  if p_amount_microusd < 0 then
    return false;
  end if;

  select *
  into v_workflow
  from public.agent_workflows
  where id = p_workflow_id
    and owner_ref = p_owner_ref
  for update;

  if not found then
    return false;
  end if;

  select *
  into v_node
  from public.agent_workflow_nodes
  where id = p_node_id
    and workflow_id = p_workflow_id
  for update;

  if not found
     or v_node.node_kind <> 'media'
     or v_node.status <> 'needs_approval'
     or v_node.budget_reserved_microusd <> 0 then
    return false;
  end if;

  if v_workflow.actual_spend_microusd
     + v_workflow.reserved_spend_microusd
     + p_amount_microusd
     > v_workflow.max_spend_microusd then
    return false;
  end if;

  update public.agent_workflows
  set reserved_spend_microusd =
        reserved_spend_microusd + p_amount_microusd,
      status = case
        when status = 'needs_approval' then 'running'
        else status
      end,
      completed_at = null,
      updated_at = now()
  where id = p_workflow_id;

  update public.agent_workflow_nodes
  set budget_reserved_microusd = p_amount_microusd,
      status = 'running',
      approved_at = now(),
      started_at = coalesce(started_at, now()),
      completed_at = null,
      updated_at = now()
  where id = p_node_id;

  return true;
end;
$$;

revoke all on function public.reserve_agent_workflow_node_budget(text,uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_workflow_node_budget(text,uuid,uuid,bigint)
  to service_role;
