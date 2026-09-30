alter table public.inference_jobs
  add column if not exists reference_mode text;

alter table public.inference_jobs
  drop constraint if exists inference_jobs_reference_mode_check,
  add constraint inference_jobs_reference_mode_check
    check (reference_mode is null or reference_mode in ('none','img2img','ip-adapter'));
