alter table public.personal_ai_settings
  add column if not exists max_spend_per_prompt_usd numeric(10,4) not null default 0.05;

alter table public.personal_ai_settings
  drop constraint if exists personal_ai_settings_max_spend_per_prompt_usd_check;

alter table public.personal_ai_settings
  add constraint personal_ai_settings_max_spend_per_prompt_usd_check
  check (max_spend_per_prompt_usd >= 0 and max_spend_per_prompt_usd <= 100);
