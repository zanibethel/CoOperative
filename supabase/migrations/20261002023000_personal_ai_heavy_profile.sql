alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_profile_check;
alter table public.text_inference_jobs
  add constraint text_inference_jobs_profile_check
  check (profile in ('fast','quality','heavy'));

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_routing_mode_check;
alter table public.text_inference_jobs
  add constraint text_inference_jobs_routing_mode_check
  check (routing_mode in ('manual','auto','local-fast','local-quality','local-heavy'));
