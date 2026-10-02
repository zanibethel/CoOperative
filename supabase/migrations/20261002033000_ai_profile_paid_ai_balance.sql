-- Funded AI balance for profile-gated paid model execution.
-- Values are stored in micro-USD (1 USD = 1,000,000 micro-USD) so sub-cent model usage remains auditable.

create table if not exists public.ai_profile_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_microusd bigint not null default 0 check (balance_microusd >= 0),
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  lifetime_spent_microusd bigint not null default 0 check (lifetime_spent_microusd >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reserved_microusd <= balance_microusd)
);

create table if not exists public.ai_profile_balance_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reserved_microusd bigint not null check (reserved_microusd > 0),
  actual_microusd bigint check (actual_microusd is null or actual_microusd >= 0),
  status text not null default 'reserved'
    check (status in ('reserved','settled','released')),
  source text not null check (char_length(source) between 1 and 120),
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  released_at timestamptz
);

create table if not exists public.ai_profile_balance_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid references public.ai_profile_balance_reservations(id) on delete set null,
  kind text not null check (kind in ('credit','debit','adjustment')),
  amount_microusd bigint not null,
  source text not null check (char_length(source) between 1 and 120),
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_profile_balance_reservations_user_status_idx
  on public.ai_profile_balance_reservations(user_id, status, created_at desc);

create index if not exists ai_profile_balance_ledger_user_created_idx
  on public.ai_profile_balance_ledger(user_id, created_at desc);

alter table public.ai_profile_balances enable row level security;
alter table public.ai_profile_balance_reservations enable row level security;
alter table public.ai_profile_balance_ledger enable row level security;

revoke all on table public.ai_profile_balances from anon, authenticated;
revoke all on table public.ai_profile_balance_reservations from anon, authenticated;
revoke all on table public.ai_profile_balance_ledger from anon, authenticated;

grant all on table public.ai_profile_balances to service_role;
grant all on table public.ai_profile_balance_reservations to service_role;
grant all on table public.ai_profile_balance_ledger to service_role;
grant usage, select on sequence public.ai_profile_balance_ledger_id_seq to service_role;

create or replace function public.reserve_ai_profile_balance(
  p_user_id uuid,
  p_amount_microusd bigint,
  p_source text,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_balance bigint;
  v_reserved bigint;
begin
  if p_amount_microusd is null or p_amount_microusd <= 0 then
    raise exception 'Reservation amount must be positive.';
  end if;

  insert into public.ai_profile_balances(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance_microusd, reserved_microusd
    into v_balance, v_reserved
  from public.ai_profile_balances
  where user_id = p_user_id
  for update;

  if (v_balance - v_reserved) < p_amount_microusd then
    return null;
  end if;

  insert into public.ai_profile_balance_reservations(
    user_id,
    reserved_microusd,
    source,
    reference_id,
    metadata
  )
  values (
    p_user_id,
    p_amount_microusd,
    left(coalesce(p_source, 'paid-ai'), 120),
    p_reference_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  update public.ai_profile_balances
  set reserved_microusd = reserved_microusd + p_amount_microusd,
      updated_at = now()
  where user_id = p_user_id;

  return v_id;
end;
$$;

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
  if v_reservation.status <> 'reserved' then
    raise exception 'Reservation is not active.';
  end if;
  select balance_microusd, reserved_microusd
    into v_balance, v_reserved
  from public.ai_profile_balances
  where user_id = v_reservation.user_id
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
  where user_id = v_reservation.user_id
  returning balance_microusd - reserved_microusd into v_balance;

  update public.ai_profile_balance_reservations
  set status = 'settled',
      actual_microusd = p_actual_microusd,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      settled_at = now()
  where id = p_reservation_id;

  if p_actual_microusd > 0 then
    insert into public.ai_profile_balance_ledger(
      user_id,
      reservation_id,
      kind,
      amount_microusd,
      source,
      reference_id,
      metadata
    )
    values (
      v_reservation.user_id,
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

create or replace function public.release_ai_profile_balance(
  p_reservation_id uuid,
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
begin
  select * into v_reservation
  from public.ai_profile_balance_reservations
  where id = p_reservation_id
  for update;

  if v_reservation.id is null then
    raise exception 'Reservation not found.';
  end if;

  if v_reservation.status <> 'reserved' then
    select balance_microusd - reserved_microusd into v_balance
    from public.ai_profile_balances
    where user_id = v_reservation.user_id;
    return coalesce(v_balance, 0);
  end if;

  update public.ai_profile_balances
  set reserved_microusd = reserved_microusd - v_reservation.reserved_microusd,
      updated_at = now()
  where user_id = v_reservation.user_id
  returning balance_microusd - reserved_microusd into v_balance;

  update public.ai_profile_balance_reservations
  set status = 'released',
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      released_at = now()
  where id = p_reservation_id;

  return v_balance;
end;
$$;

create or replace function public.credit_ai_profile_balance(
  p_user_id uuid,
  p_amount_microusd bigint,
  p_source text,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount_microusd is null or p_amount_microusd <= 0 then
    raise exception 'Credit amount must be positive.';
  end if;

  insert into public.ai_profile_balances(user_id, balance_microusd)
  values (p_user_id, p_amount_microusd)
  on conflict (user_id) do update
    set balance_microusd = public.ai_profile_balances.balance_microusd + excluded.balance_microusd,
        updated_at = now()
  returning balance_microusd - reserved_microusd into v_balance;

  insert into public.ai_profile_balance_ledger(
    user_id,
    kind,
    amount_microusd,
    source,
    reference_id,
    metadata
  )
  values (
    p_user_id,
    'credit',
    p_amount_microusd,
    left(coalesce(p_source, 'funding'), 120),
    p_reference_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_balance;
end;
$$;

revoke all on function public.reserve_ai_profile_balance(uuid,bigint,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.settle_ai_profile_balance(uuid,bigint,jsonb)
  from public, anon, authenticated;
revoke all on function public.release_ai_profile_balance(uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.credit_ai_profile_balance(uuid,bigint,text,text,jsonb)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_profile_balance(uuid,bigint,text,text,jsonb)
  to service_role;
grant execute on function public.settle_ai_profile_balance(uuid,bigint,jsonb)
  to service_role;
grant execute on function public.release_ai_profile_balance(uuid,jsonb)
  to service_role;
grant execute on function public.credit_ai_profile_balance(uuid,bigint,text,text,jsonb)
  to service_role;
