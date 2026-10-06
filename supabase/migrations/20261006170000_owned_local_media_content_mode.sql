alter table public.inference_jobs
  add column if not exists content_mode text not null default 'sfw';

alter table public.inference_jobs
  drop constraint if exists inference_jobs_content_mode_check;

alter table public.inference_jobs
  add constraint inference_jobs_content_mode_check
  check (content_mode in ('sfw','adult_non_explicit','adult_explicit'));
