alter table public.media_generation_jobs
  add column if not exists request_root_job_id uuid,
  add column if not exists route_attempt integer not null default 1,
  add column if not exists execution_mode text not null default 'legacy';

update public.media_generation_jobs
set request_root_job_id = id
where request_root_job_id is null;

alter table public.media_generation_jobs
  alter column request_root_job_id set not null;

alter table public.media_generation_jobs
  drop constraint if exists media_generation_jobs_route_attempt_check;

alter table public.media_generation_jobs
  add constraint media_generation_jobs_route_attempt_check
  check (route_attempt >= 1 and route_attempt <= 50);

alter table public.media_generation_jobs
  drop constraint if exists media_generation_jobs_execution_mode_check;

alter table public.media_generation_jobs
  add constraint media_generation_jobs_execution_mode_check
  check (execution_mode ~ '^[a-z][a-z0-9-]{0,63}$');

create index if not exists media_generation_jobs_request_root_idx
  on public.media_generation_jobs (request_root_job_id, route_attempt, created_at);

create unique index if not exists media_generation_jobs_one_active_attempt_per_request
  on public.media_generation_jobs (request_root_job_id)
  where status in ('queued','running');

comment on column public.media_generation_jobs.request_root_job_id is
  'Stable request-level execution ledger id shared by every provider attempt/fallback for one user media request.';

comment on column public.media_generation_jobs.route_attempt is
  'Monotonic route-attempt number within request_root_job_id.';

comment on column public.media_generation_jobs.execution_mode is
  'Extensible execution-path identifier such as direct-provider, hermes, or recovery-retry.';
