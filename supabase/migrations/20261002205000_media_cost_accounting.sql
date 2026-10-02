alter table public.media_generation_jobs
  add column if not exists estimated_infrastructure_cost_microusd bigint
    check (estimated_infrastructure_cost_microusd is null or estimated_infrastructure_cost_microusd >= 0),
  add column if not exists estimated_user_charge_microusd bigint
    check (estimated_user_charge_microusd is null or estimated_user_charge_microusd >= 0),
  add column if not exists estimated_margin_microusd bigint,
  add column if not exists actual_provider_cost_microusd bigint
    check (actual_provider_cost_microusd is null or actual_provider_cost_microusd >= 0),
  add column if not exists actual_infrastructure_cost_microusd bigint
    check (actual_infrastructure_cost_microusd is null or actual_infrastructure_cost_microusd >= 0),
  add column if not exists actual_user_charge_microusd bigint
    check (actual_user_charge_microusd is null or actual_user_charge_microusd >= 0),
  add column if not exists actual_margin_microusd bigint,
  add column if not exists provider_cost_bearer text
    check (
      provider_cost_bearer is null
      or provider_cost_bearer in ('user-connected', 'cooperative', 'free')
    ),
  add column if not exists pricing_dimensions jsonb not null default '{}'::jsonb;

comment on column public.media_generation_jobs.estimated_provider_cost_microusd is
  'Estimated upstream model/provider cost for the media call, separate from CoOperative infrastructure and user charge.';
comment on column public.media_generation_jobs.estimated_infrastructure_cost_microusd is
  'Estimated CoOperative infrastructure/tool execution cost. Null means not yet measured; never treat null as zero.';
comment on column public.media_generation_jobs.estimated_user_charge_microusd is
  'Estimated amount CoOperative itself charges the user for this job. Current testing routes set this to zero.';
comment on column public.media_generation_jobs.estimated_margin_microusd is
  'Estimated CoOperative margin after CoOperative-borne costs. Null until all required cost components are measured.';
comment on column public.media_generation_jobs.provider_cost_bearer is
  'Who bears the upstream provider cost: user-connected entitlement/credits, CoOperative, or free.';
comment on column public.media_generation_jobs.pricing_dimensions is
  'Pricing inputs used for the decision, such as duration, resolution, audio, aspect ratio, media level, and free-route state.';
