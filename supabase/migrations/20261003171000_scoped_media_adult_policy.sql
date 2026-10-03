alter table public.media_model_capabilities
  add column if not exists adult_non_explicit_policy text not null default 'unknown',
  add column if not exists adult_non_explicit_policy_source text,
  add column if not exists adult_non_explicit_policy_checked_at timestamptz,
  add column if not exists adult_explicit_policy text not null default 'unknown',
  add column if not exists adult_explicit_policy_source text,
  add column if not exists adult_explicit_policy_checked_at timestamptz;

alter table public.media_model_capabilities
  drop constraint if exists media_model_capabilities_adult_non_explicit_policy_check,
  drop constraint if exists media_model_capabilities_adult_explicit_policy_check;

alter table public.media_model_capabilities
  add constraint media_model_capabilities_adult_non_explicit_policy_check
  check (adult_non_explicit_policy in ('unknown', 'disallowed', 'allowed')),
  add constraint media_model_capabilities_adult_explicit_policy_check
  check (adult_explicit_policy in ('unknown', 'disallowed', 'allowed'));

update public.media_model_capabilities
set
  adult_explicit_policy = 'disallowed',
  adult_explicit_policy_source =
    'https://portal.nousresearch.com/terms ; https://fal.ai/legal/acceptable-use-policy',
  adult_explicit_policy_checked_at = now(),
  adult_non_explicit_policy_source =
    'https://portal.nousresearch.com/terms ; https://fal.ai/legal/acceptable-use-policy',
  adult_non_explicit_policy_checked_at = now()
where provider = 'nous';
