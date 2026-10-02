-- Stripe-backed funded balance top-ups for paid AI execution.
-- CoOperative never permits paid AI to overdraw this balance.

create table if not exists public.ai_balance_topup_options (
  id text primary key check (char_length(id) between 1 and 80),
  label text not null check (char_length(label) between 1 and 120),
  amount_microusd bigint not null check (amount_microusd > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_link_id text not null unique,
  checkout_url text not null,
  livemode boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_balance_funding_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_ref text not null
    references public.ai_profile_balances(profile_ref) on delete cascade,
  topup_option_id text not null
    references public.ai_balance_topup_options(id) on delete restrict,
  amount_microusd bigint not null check (amount_microusd > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_link_id text not null,
  provider_session_id text unique,
  provider_payment_intent_id text,
  status text not null default 'pending'
    check (status in ('pending','paid','expired','cancelled','refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ai_balance_funding_intents_user_created_idx
  on public.ai_balance_funding_intents(user_id, created_at desc);

create index if not exists ai_balance_funding_intents_profile_status_idx
  on public.ai_balance_funding_intents(profile_ref, status, created_at desc);

create table if not exists public.billing_provider_secrets (
  provider text not null,
  secret_kind text not null,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, secret_kind)
);

alter table public.ai_balance_topup_options enable row level security;
alter table public.ai_balance_funding_intents enable row level security;
alter table public.billing_provider_secrets enable row level security;

revoke all on table public.ai_balance_topup_options from anon, authenticated;
revoke all on table public.ai_balance_funding_intents from anon, authenticated;
revoke all on table public.billing_provider_secrets from anon, authenticated;

grant all on table public.ai_balance_topup_options to service_role;
grant all on table public.ai_balance_funding_intents to service_role;
grant all on table public.billing_provider_secrets to service_role;

create or replace function public.complete_ai_balance_topup(
  p_intent_id uuid,
  p_amount_microusd bigint,
  p_provider_session_id text,
  p_provider_payment_intent_id text default null,
  p_provider_payment_link_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.ai_balance_funding_intents%rowtype;
  v_available bigint;
begin
  select *
    into v_intent
  from public.ai_balance_funding_intents
  where id = p_intent_id
  for update;

  if v_intent.id is null then
    raise exception 'Funding intent not found.';
  end if;

  if v_intent.status = 'paid' then
    select balance_microusd - reserved_microusd
      into v_available
    from public.ai_profile_balances
    where profile_ref = v_intent.profile_ref;
    return coalesce(v_available, 0);
  end if;

  if v_intent.status <> 'pending' then
    raise exception 'Funding intent is not payable.';
  end if;

  if p_amount_microusd is null or p_amount_microusd <> v_intent.amount_microusd then
    raise exception 'Paid amount does not match funding intent.';
  end if;

  if coalesce(p_provider_payment_link_id, '') <> v_intent.provider_payment_link_id then
    raise exception 'Payment link does not match funding intent.';
  end if;

  if p_provider_session_id is null or char_length(p_provider_session_id) < 4 then
    raise exception 'Provider session is required.';
  end if;

  insert into public.ai_profile_balances(profile_ref)
  values (v_intent.profile_ref)
  on conflict (profile_ref) do nothing;

  update public.ai_profile_balances
  set balance_microusd = balance_microusd + v_intent.amount_microusd,
      updated_at = now()
  where profile_ref = v_intent.profile_ref
  returning balance_microusd - reserved_microusd into v_available;

  insert into public.ai_profile_balance_ledger(
    profile_ref,
    kind,
    amount_microusd,
    source,
    reference_id,
    metadata
  )
  values (
    v_intent.profile_ref,
    'credit',
    v_intent.amount_microusd,
    'stripe-balance-topup',
    p_provider_session_id,
    jsonb_build_object(
      'fundingIntentId', v_intent.id,
      'topupOptionId', v_intent.topup_option_id,
      'paymentLinkId', v_intent.provider_payment_link_id,
      'paymentIntentId', p_provider_payment_intent_id
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  update public.ai_balance_funding_intents
  set status = 'paid',
      provider_session_id = p_provider_session_id,
      provider_payment_intent_id = p_provider_payment_intent_id,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      completed_at = now(),
      updated_at = now()
  where id = v_intent.id;

  return v_available;
end;
$$;

create or replace function public.expire_ai_balance_topup(
  p_intent_id uuid,
  p_provider_session_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean := false;
begin
  update public.ai_balance_funding_intents
  set status = 'expired',
      provider_session_id = coalesce(provider_session_id, p_provider_session_id),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where id = p_intent_id
    and status = 'pending';

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.complete_ai_balance_topup(uuid,bigint,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.expire_ai_balance_topup(uuid,text,jsonb)
  from public, anon, authenticated;

grant execute on function public.complete_ai_balance_topup(uuid,bigint,text,text,text,jsonb)
  to service_role;
grant execute on function public.expire_ai_balance_topup(uuid,text,jsonb)
  to service_role;
