
alter table public.ai_model_registry
  add column if not exists score_summary jsonb not null default '{}'::jsonb,
  add column if not exists score_version text null,
  add column if not exists score_updated_at timestamptz null;

create table if not exists public.ai_model_task_scores (
  id uuid primary key default gen_random_uuid(),
  registry_route_id uuid not null references public.ai_model_registry(id) on delete cascade,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  route_kind text not null,
  task_type text not null,
  capability_fit_score numeric not null,
  quality_score numeric null,
  reliability_score numeric null,
  speed_score numeric null,
  performance_score numeric not null,
  cost_efficiency_score numeric not null,
  overall_value_score numeric not null,
  confidence numeric not null,
  quality_sample_count integer not null default 0,
  runtime_sample_count integer not null default 0,
  latency_sample_count integer not null default 0,
  benchmark_coverage numeric not null default 0,
  representative_cost_usd numeric null,
  score_version text not null,
  source_summary jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_task_scores_identity_unique
    unique (registry_route_id, task_type),
  constraint ai_model_task_scores_route_kind_check
    check (route_kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_task_scores_task_type_check
    check (task_type ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint ai_model_task_scores_score_version_check
    check (char_length(score_version) between 1 and 64),
  constraint ai_model_task_scores_score_bounds_check
    check (
      capability_fit_score between 0 and 100
      and (quality_score is null or quality_score between 0 and 100)
      and (reliability_score is null or reliability_score between 0 and 100)
      and (speed_score is null or speed_score between 0 and 100)
      and performance_score between 0 and 100
      and cost_efficiency_score between 0 and 100
      and overall_value_score between 0 and 100
      and confidence between 0 and 1
      and benchmark_coverage between 0 and 1
    ),
  constraint ai_model_task_scores_sample_counts_check
    check (
      quality_sample_count >= 0
      and runtime_sample_count >= 0
      and latency_sample_count >= 0
    ),
  constraint ai_model_task_scores_cost_check
    check (representative_cost_usd is null or representative_cost_usd >= 0)
);

create index if not exists ai_model_task_scores_task_rank_idx
  on public.ai_model_task_scores
  (task_type, overall_value_score desc, confidence desc, cost_efficiency_score desc);

create index if not exists ai_model_task_scores_route_idx
  on public.ai_model_task_scores
  (registry_route_id, task_type);

alter table public.ai_model_task_scores enable row level security;

comment on table public.ai_model_task_scores is
  'Current task-specific performance, cost-efficiency, and value scores for model registry routes. Scores are evidence-aware and include confidence/sample counts.';
