alter table public.ai_balance_topup_options
  add column if not exists provider_price_id text;

update public.ai_balance_topup_options
set provider_price_id = 'price_1UNl01PywVHCXFYifBkEUlL3',
    updated_at = now()
where id = 'stripe-elements-test-10';

create index if not exists ai_balance_topup_options_provider_price_idx
  on public.ai_balance_topup_options (provider_price_id)
  where provider_price_id is not null;
