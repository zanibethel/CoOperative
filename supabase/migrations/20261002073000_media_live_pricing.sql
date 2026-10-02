alter table public.media_generation_jobs
  add column if not exists media_level integer
    check (media_level is null or media_level between 0 and 4),
  add column if not exists estimated_provider_cost_microusd bigint
    check (estimated_provider_cost_microusd is null or estimated_provider_cost_microusd >= 0),
  add column if not exists pricing_source text;
