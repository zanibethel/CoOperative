create table if not exists public.media_reference_model_verifications (
  owner_ref text not null,
  provider text not null,
  model text not null,
  edit_endpoint text not null,
  status text not null check (status in ('verified', 'failed')),
  source_job_id uuid references public.media_generation_jobs(id) on delete set null,
  verified_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_ref, provider, edit_endpoint)
);

create index if not exists media_reference_model_verifications_model_idx
  on public.media_reference_model_verifications (provider, model, edit_endpoint);

alter table public.media_reference_model_verifications enable row level security;

insert into public.media_reference_model_verifications (
  owner_ref,
  provider,
  model,
  edit_endpoint,
  status,
  source_job_id,
  verified_at,
  last_attempt_at,
  failure_reason,
  created_at,
  updated_at
)
select
  owner_ref,
  provider,
  model,
  pricing_dimensions->>'referenceEditEndpoint',
  'verified',
  id,
  completed_at,
  coalesce(completed_at, created_at),
  null,
  coalesce(completed_at, created_at),
  coalesce(completed_at, created_at)
from public.media_generation_jobs
where status = 'completed'
  and provider = 'nous'
  and coalesce(pricing_dimensions->>'referenceSmokeTest', 'false') = 'true'
  and nullif(pricing_dimensions->>'referenceEditEndpoint', '') is not null
on conflict (owner_ref, provider, edit_endpoint)
do update set
  model = excluded.model,
  status = 'verified',
  source_job_id = excluded.source_job_id,
  verified_at = excluded.verified_at,
  last_attempt_at = excluded.last_attempt_at,
  failure_reason = null,
  updated_at = excluded.updated_at;
