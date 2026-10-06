
alter table public.text_inference_jobs
  add column if not exists comparison_image_job_id uuid
    references public.inference_jobs(id) on delete set null;

create index if not exists text_inference_jobs_comparison_image_job_idx
  on public.text_inference_jobs(comparison_image_job_id, created_at desc)
  where comparison_image_job_id is not null;
