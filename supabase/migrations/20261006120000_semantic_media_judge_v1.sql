alter table public.text_inference_jobs
  add column if not exists source_image_job_id uuid
    references public.inference_jobs(id) on delete set null;

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_capability_check,
  add constraint text_inference_jobs_capability_check
    check (capability in ('text','vision','media-judge'));

create index if not exists text_inference_jobs_source_image_job_idx
  on public.text_inference_jobs(source_image_job_id, created_at desc)
  where source_image_job_id is not null;

comment on column public.text_inference_jobs.source_image_job_id is
  'Generated image job inspected by an internal semantic media judge. Used only for local composable-media verification and repair planning.';
