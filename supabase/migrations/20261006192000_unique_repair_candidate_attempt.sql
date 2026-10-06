
create unique index if not exists inference_jobs_single_repair_attempt_idx
  on public.inference_jobs(parent_image_job_id, repair_attempt)
  where parent_image_job_id is not null
    and pipeline_role = 'repair-candidate';
