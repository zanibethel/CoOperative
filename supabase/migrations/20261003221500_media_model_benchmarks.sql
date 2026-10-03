create table if not exists public.media_model_benchmarks (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  benchmark_suite text not null default 'media_quality_v1',
  dimension text not null
    check (
      dimension in (
        'visual_quality',
        'prompt_adherence',
        'anatomy',
        'reference_fidelity',
        'edit_strength',
        'speed'
      )
    ),
  score numeric(5,2)
    check (score is null or (score >= 0 and score <= 100)),
  status text not null default 'measured'
    check (status in ('measured', 'inconclusive')),
  measurement jsonb not null default '{}'::jsonb,
  source_type text not null default 'controlled_benchmark'
    check (
      source_type in (
        'controlled_benchmark',
        'manual_review',
        'runtime_observation',
        'provider_metadata'
      )
    ),
  source_job_id uuid references public.media_generation_jobs(id) on delete set null,
  notes text,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists media_model_benchmarks_lookup_idx
  on public.media_model_benchmarks (
    owner_ref,
    provider,
    model,
    endpoint,
    dimension,
    measured_at desc
  );

create index if not exists media_model_benchmarks_source_job_idx
  on public.media_model_benchmarks (source_job_id)
  where source_job_id is not null;

alter table public.media_model_benchmarks enable row level security;
