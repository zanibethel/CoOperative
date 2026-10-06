
alter table public.agent_workflows
  add column if not exists reserved_spend_microusd bigint not null default 0;

alter table public.agent_workflow_nodes
  add column if not exists budget_reserved_microusd bigint not null default 0,
  add column if not exists approved_at timestamptz null;

alter table public.agent_workflows
  drop constraint if exists agent_workflows_reserved_spend_check;

alter table public.agent_workflows
  add constraint agent_workflows_reserved_spend_check
  check (
    reserved_spend_microusd >= 0
    and actual_spend_microusd >= 0
    and reserved_spend_microusd + actual_spend_microusd <= max_spend_microusd
  );

alter table public.agent_workflow_nodes
  drop constraint if exists agent_workflow_nodes_budget_reserved_check;

alter table public.agent_workflow_nodes
  add constraint agent_workflow_nodes_budget_reserved_check
  check (budget_reserved_microusd >= 0);

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
      updated_at = now()
  where id = p_node_id;

  return true;
end;
$$;

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

  if not found or v_node.budget_reserved_microusd <= 0 then
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

create or replace function public.release_agent_workflow_node_budget(
  p_owner_ref text,
  p_workflow_id uuid,
  p_node_id uuid
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

  if not found then
    return false;
  end if;

  update public.agent_workflows
  set reserved_spend_microusd =
        greatest(0, reserved_spend_microusd - v_node.budget_reserved_microusd),
      updated_at = now()
  where id = p_workflow_id;

  update public.agent_workflow_nodes
  set budget_reserved_microusd = 0,
      updated_at = now()
  where id = p_node_id;

  return true;
end;
$$;

revoke all on function public.reserve_agent_workflow_node_budget(text,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.release_agent_workflow_node_budget(text,uuid,uuid) from public, anon, authenticated;

grant execute on function public.reserve_agent_workflow_node_budget(text,uuid,uuid,bigint) to service_role;
grant execute on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint) to service_role;
grant execute on function public.release_agent_workflow_node_budget(text,uuid,uuid) to service_role;
