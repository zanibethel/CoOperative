create table if not exists public.ai_model_scan_runs (
  id uuid primary key default gen_random_uuid(),
  scanner_version text not null,
  trigger_source text not null default 'manual',
  status text not null default 'running',
  sources jsonb not null default '[]'::jsonb,
  discovered_count integer not null default 0,
  new_count integer not null default 0,
  changed_count integer not null default 0,
  missing_count integer not null default 0,
  error text null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_model_scan_runs_status_check
    check (status ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_scan_runs_trigger_check
    check (trigger_source ~ '^[a-z][a-z0-9-]{0,63}$')
);

create table if not exists public.ai_model_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  endpoint text not null default '',
  route_kind text not null,
  display_name text not null,
  source text not null,
  status text not null default 'active',
  free boolean not null default false,
  recommended boolean not null default false,
  execution_ready boolean not null default false,
  input_modalities jsonb not null default '[]'::jsonb,
  output_modalities jsonb not null default '[]'::jsonb,
  capability_summary jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  policy_summary jsonb not null default '{}'::jsonb,
  benchmark_summary jsonb not null default '{}'::jsonb,
  runtime_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  current_fingerprint text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  last_scan_id uuid null references public.ai_model_scan_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_registry_route_kind_check
    check (route_kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_registry_status_check
    check (status ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_registry_identity_unique
    unique (provider, model, endpoint, route_kind)
);

create table if not exists public.ai_model_capability_evidence (
  id uuid primary key default gen_random_uuid(),
  registry_route_id uuid null references public.ai_model_registry(id) on delete cascade,
  owner_ref text null,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  route_kind text not null,
  capability_key text not null,
  scope text not null default '',
  state text not null,
  source_type text not null,
  source_ref text null,
  confidence numeric not null default 0.5,
  observed_at timestamptz not null default now(),
  expires_at timestamptz null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_model_capability_evidence_route_kind_check
    check (route_kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_capability_evidence_capability_key_check
    check (capability_key ~ '^[a-z][a-z0-9-]{0,127}$'),
  constraint ai_model_capability_evidence_state_check
    check (state ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_capability_evidence_source_type_check
    check (source_type ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_capability_evidence_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

create table if not exists public.ai_model_scan_changes (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.ai_model_scan_runs(id) on delete cascade,
  registry_route_id uuid null references public.ai_model_registry(id) on delete set null,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  route_kind text not null,
  change_type text not null,
  previous_fingerprint text null,
  new_fingerprint text null,
  changed_fields jsonb not null default '[]'::jsonb,
  before_summary jsonb not null default '{}'::jsonb,
  after_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_model_scan_changes_route_kind_check
    check (route_kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_scan_changes_change_type_check
    check (change_type ~ '^[a-z][a-z0-9-]{0,63}$')
);

create index if not exists ai_model_registry_provider_kind_idx
  on public.ai_model_registry (provider, route_kind, status, last_seen_at desc);

create index if not exists ai_model_registry_last_scan_idx
  on public.ai_model_registry (last_scan_id, last_seen_at desc);

create index if not exists ai_model_capability_evidence_route_idx
  on public.ai_model_capability_evidence
  (provider, model, endpoint, route_kind, capability_key, observed_at desc);

create index if not exists ai_model_capability_evidence_registry_idx
  on public.ai_model_capability_evidence
  (registry_route_id, capability_key, observed_at desc);

create index if not exists ai_model_scan_changes_scan_idx
  on public.ai_model_scan_changes (scan_id, change_type, created_at);

alter table public.ai_model_scan_runs enable row level security;
alter table public.ai_model_registry enable row level security;
alter table public.ai_model_capability_evidence enable row level security;
alter table public.ai_model_scan_changes enable row level security;

comment on table public.ai_model_registry is
  'Canonical service-side registry of currently discovered AI model routes across providers, modalities, local runtimes, pricing, policy, and routing metadata.';

comment on table public.ai_model_capability_evidence is
  'Append-only evidence about model/route capabilities. New observations are added rather than destroying prior evidence so routing decisions remain auditable over time.';

comment on table public.ai_model_scan_runs is
  'History of model-capability scanner runs and source coverage.';

comment on table public.ai_model_scan_changes is
  'Per-scan model route additions, changes, missing routes, and restorations.';
