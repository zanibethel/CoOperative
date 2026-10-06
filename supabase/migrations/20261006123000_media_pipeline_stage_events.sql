
create table if not exists public.media_pipeline_stage_events (
  id uuid primary key default gen_random_uuid(),
  source_image_job_id uuid not null references public.inference_jobs(id) on delete cascade,
  stage text not null,
  version text not null default '',
  status text not null check (status in ('queued','running','completed','failed','skipped')),
  component text,
  model text,
  provider text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  score numeric check (score is null or (score >= 0 and score <= 100)),
  prompt_adherence numeric check (prompt_adherence is null or (prompt_adherence >= 0 and prompt_adherence <= 100)),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  findings_count integer check (findings_count is null or findings_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  unique (source_image_job_id, stage, version)
);

alter table public.media_pipeline_stage_events enable row level security;
revoke all on table public.media_pipeline_stage_events from anon, authenticated;
grant all on table public.media_pipeline_stage_events to service_role;

create index if not exists media_pipeline_stage_events_observed_idx
  on public.media_pipeline_stage_events(observed_at desc);

insert into public.media_pipeline_stage_events (
  source_image_job_id,
  stage,
  version,
  status,
  component,
  model,
  provider,
  latency_ms,
  score,
  prompt_adherence,
  confidence,
  findings_count,
  metadata,
  observed_at
)
select
  j.id,
  'semantic-quality-judge',
  coalesce(j.pipeline_trace #>> '{semanticJudge,version}', 'semantic-vision-v1'),
  case
    when j.pipeline_trace #>> '{semanticJudge,status}' in ('completed','failed','queued','running')
      then j.pipeline_trace #>> '{semanticJudge,status}'
    else 'skipped'
  end,
  'local-vision',
  nullif(j.pipeline_trace #>> '{semanticJudge,model}', ''),
  nullif(j.pipeline_trace #>> '{semanticJudge,provider}', ''),
  case
    when (j.pipeline_trace #>> '{semanticJudge,latencyMs}') ~ '^[0-9]+$'
      then (j.pipeline_trace #>> '{semanticJudge,latencyMs}')::integer
    else null
  end,
  case
    when (j.pipeline_trace #>> '{semanticJudge,report,overallScore}') ~ '^[0-9]+([.][0-9]+)?$'
      then (j.pipeline_trace #>> '{semanticJudge,report,overallScore}')::numeric
    else null
  end,
  case
    when (j.pipeline_trace #>> '{semanticJudge,report,promptAdherence}') ~ '^[0-9]+([.][0-9]+)?$'
      then (j.pipeline_trace #>> '{semanticJudge,report,promptAdherence}')::numeric
    else null
  end,
  case
    when (j.pipeline_trace #>> '{semanticJudge,report,confidence}') ~ '^[0-9]+([.][0-9]+)?$'
      then (j.pipeline_trace #>> '{semanticJudge,report,confidence}')::numeric
    else null
  end,
  case
    when jsonb_typeof(j.pipeline_trace #> '{semanticJudge,report,findings}') = 'array'
      then jsonb_array_length(j.pipeline_trace #> '{semanticJudge,report,findings}')
    else null
  end,
  jsonb_build_object(
    'judgeJobId', j.pipeline_trace #>> '{semanticJudge,judgeJobId}',
    'report', coalesce(j.pipeline_trace #> '{semanticJudge,report}', '{}'::jsonb),
    'error', j.pipeline_trace #>> '{semanticJudge,error}'
  ),
  j.updated_at
from public.inference_jobs j
where j.pipeline_trace ? 'semanticJudge'
on conflict (source_image_job_id, stage, version)
do update set
  status = excluded.status,
  component = excluded.component,
  model = excluded.model,
  provider = excluded.provider,
  latency_ms = excluded.latency_ms,
  score = excluded.score,
  prompt_adherence = excluded.prompt_adherence,
  confidence = excluded.confidence,
  findings_count = excluded.findings_count,
  metadata = excluded.metadata,
  observed_at = excluded.observed_at;
