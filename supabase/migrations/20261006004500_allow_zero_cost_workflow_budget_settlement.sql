
create or replace function public.settle_agent_workflow_node_budget(
  p_owner_ref text,
  p_workflow_id uuid,
  p_node_id uuid,
  p_actual_microusd bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow public.agent_workflows%rowtype;
  v_node public.agent_workflow_nodes%rowtype;
  v_actual bigint;
begin
  v_actual := greatest(0, p_actual_microusd);

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

  if not found or v_node.status <> 'running' then
    return false;
  end if;

  if v_actual > v_node.budget_reserved_microusd then
    return false;
  end if;

  update public.agent_workflows
  set reserved_spend_microusd =
        greatest(0, reserved_spend_microusd - v_node.budget_reserved_microusd),
      actual_spend_microusd = actual_spend_microusd + v_actual,
      updated_at = now()
  where id = p_workflow_id;

  update public.agent_workflow_nodes
  set budget_reserved_microusd = 0,
      actual_cost_microusd = v_actual,
      updated_at = now()
  where id = p_node_id;

  return true;
end;
$$;

revoke all on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint) to service_role;
