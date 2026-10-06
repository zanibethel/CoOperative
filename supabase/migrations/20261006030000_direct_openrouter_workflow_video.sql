alter table public.media_generation_jobs
  add column if not exists provider_job_id text,
  add column if not exists provider_polling_url text,
  add column if not exists provider_polled_at timestamptz;

create unique index if not exists media_generation_jobs_provider_job_unique
  on public.media_generation_jobs(provider, provider_job_id)
  where provider_job_id is not null;

create index if not exists media_generation_jobs_provider_poll_idx
  on public.media_generation_jobs(status, provider_polled_at)
  where provider_job_id is not null
    and status in ('queued','running');
