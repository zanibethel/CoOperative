
alter table public.inference_jobs
  add column if not exists parent_image_job_id uuid
    references public.inference_jobs(id) on delete set null,
  add column if not exists pipeline_role text not null default 'primary',
  add column if not exists repair_plan jsonb not null default '{}'::jsonb,
  add column if not exists repair_attempt integer not null default 0,
  add column if not exists accepted_result_job_id uuid
    references public.inference_jobs(id) on delete set null,
  add column if not exists verification_summary jsonb not null default '{}'::jsonb;

alter table public.inference_jobs
  drop constraint if exists inference_jobs_pipeline_role_check,
  add constraint inference_jobs_pipeline_role_check
    check (pipeline_role in ('primary','repair-candidate'));

create index if not exists inference_jobs_parent_image_job_idx
  on public.inference_jobs(parent_image_job_id, created_at desc)
  where parent_image_job_id is not null;
