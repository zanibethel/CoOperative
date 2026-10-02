alter table public.media_generation_jobs
  add column if not exists fallback_from_job_id uuid
    references public.media_generation_jobs(id) on delete set null;

create index if not exists media_generation_jobs_fallback_from_idx
  on public.media_generation_jobs(fallback_from_job_id)
  where fallback_from_job_id is not null;
