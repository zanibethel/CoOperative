create table if not exists public.media_route_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  source_job_id uuid null references public.media_generation_jobs(id) on delete set null,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  execution_mode text not null default 'unknown',
  request_shape text not null,
  outcome_kind text not null,
  blocks_route boolean not null default false,
  detail text null,
  created_at timestamptz not null default now()
);

alter table public.media_route_outcomes
  drop constraint if exists media_route_outcomes_outcome_kind_check;

alter table public.media_route_outcomes
  add constraint media_route_outcomes_outcome_kind_check
  check (outcome_kind ~ '^[a-z][a-z0-9-]{0,63}$');

create index if not exists media_route_outcomes_lookup_idx
  on public.media_route_outcomes
  (owner_ref, request_shape, provider, model, endpoint, created_at desc);

create index if not exists media_route_outcomes_blocking_idx
  on public.media_route_outcomes
  (owner_ref, request_shape, blocks_route)
  where blocks_route = true;

comment on table public.media_route_outcomes is
  'Observed media execution outcomes used for routing diagnostics and safe capability learning. Policy outcomes are recorded but are not automatic cross-provider fallback signals.';
