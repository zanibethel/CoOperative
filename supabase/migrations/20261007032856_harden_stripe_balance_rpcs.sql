revoke all on function public.complete_ai_balance_topup(uuid, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_ai_balance_topup(uuid, bigint, text, text, text, jsonb)
  to service_role;

revoke all on function public.expire_ai_balance_topup(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.expire_ai_balance_topup(uuid, text, jsonb)
  to service_role;

create index if not exists ai_balance_funding_intents_topup_option_idx
  on public.ai_balance_funding_intents (topup_option_id);
