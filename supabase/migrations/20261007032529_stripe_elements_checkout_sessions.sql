alter table public.ai_balance_topup_options
  alter column provider_payment_link_id drop not null,
  alter column checkout_url drop not null;

alter table public.ai_balance_funding_intents
  alter column provider_payment_link_id drop not null;

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
set search_path to 'public'
as $function$
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

  if v_intent.provider_payment_link_id is not null
     and coalesce(p_provider_payment_link_id, '') <> v_intent.provider_payment_link_id then
    raise exception 'Payment link does not match funding intent.';
  end if;

  if p_provider_session_id is null or char_length(p_provider_session_id) < 4 then
    raise exception 'Provider session is required.';
  end if;

  if v_intent.provider_session_id is not null
     and v_intent.provider_session_id <> p_provider_session_id then
    raise exception 'Provider session does not match funding intent.';
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
$function$;

insert into public.ai_balance_topup_options (
  id, label, amount_microusd, currency, provider,
  provider_payment_link_id, checkout_url, livemode, active, sort_order
)
values (
  'stripe-elements-test-10',
  '$10 embedded test balance',
  10000000,
  'USD',
  'stripe',
  null,
  null,
  false,
  true,
  0
)
on conflict (id) do update
set label = excluded.label,
    amount_microusd = excluded.amount_microusd,
    provider_payment_link_id = null,
    checkout_url = null,
    livemode = false,
    active = true,
    sort_order = excluded.sort_order,
    updated_at = now();
