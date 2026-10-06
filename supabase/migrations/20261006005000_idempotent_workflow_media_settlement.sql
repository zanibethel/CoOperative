
create or replace function public.settle_ai_profile_balance(
  p_reservation_id uuid,
  p_actual_microusd bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.ai_profile_balance_reservations%rowtype;
  v_balance bigint;
  v_reserved bigint;
begin
  if p_actual_microusd is null or p_actual_microusd < 0 then
    raise exception 'Actual amount cannot be negative.';
  end if;

  select * into v_reservation
  from public.ai_profile_balance_reservations
  where id = p_reservation_id
  for update;

  if v_reservation.id is null then
    raise exception 'Reservation not found.';
  end if;

  if v_reservation.status = 'settled' then
    if coalesce(v_reservation.actual_microusd, -1) <> p_actual_microusd then
      raise exception 'Reservation was already settled with a different amount.';
    end if;

    select balance_microusd - reserved_microusd into v_balance
    from public.ai_profile_balances
    where profile_ref = v_reservation.profile_ref;

    return coalesce(v_balance, 0);
  end if;

  if v_reservation.status <> 'reserved' then
    raise exception 'Reservation is not active.';
  end if;

  select balance_microusd, reserved_microusd
    into v_balance, v_reserved
  from public.ai_profile_balances
  where profile_ref = v_reservation.profile_ref
  for update;

  if v_balance is null then
    raise exception 'Profile balance not found.';
  end if;

  if p_actual_microusd > v_reservation.reserved_microusd
     and (v_balance - v_reserved) <
       (p_actual_microusd - v_reservation.reserved_microusd) then
    raise exception 'Actual cost exceeds the reserved and currently available balance.';
  end if;

  update public.ai_profile_balances
  set balance_microusd = balance_microusd - p_actual_microusd,
      reserved_microusd = reserved_microusd - v_reservation.reserved_microusd,
      lifetime_spent_microusd = lifetime_spent_microusd + p_actual_microusd,
      updated_at = now()
  where profile_ref = v_reservation.profile_ref
  returning balance_microusd - reserved_microusd into v_balance;

  update public.ai_profile_balance_reservations
  set status = 'settled',
      actual_microusd = p_actual_microusd,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      settled_at = now()
  where id = p_reservation_id;

  if p_actual_microusd > 0 then
    insert into public.ai_profile_balance_ledger(
      profile_ref,
      reservation_id,
      kind,
      amount_microusd,
      source,
      reference_id,
      metadata
    )
    values (
      v_reservation.profile_ref,
      p_reservation_id,
      'debit',
      -p_actual_microusd,
      v_reservation.source,
      v_reservation.reference_id,
      coalesce(p_metadata, '{}'::jsonb)
    );
  end if;

  return v_balance;
end;
$$;

revoke all on function public.settle_ai_profile_balance(uuid,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_ai_profile_balance(uuid,bigint,jsonb)
  to service_role;

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

  if not found then
    return false;
  end if;

  if v_node.budget_reserved_microusd = 0
     and v_node.actual_cost_microusd = v_actual
     and v_node.status in ('running','completed') then
    return true;
  end if;

  if v_node.status <> 'running' then
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

revoke all on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.settle_agent_workflow_node_budget(text,uuid,uuid,bigint)
  to service_role;
