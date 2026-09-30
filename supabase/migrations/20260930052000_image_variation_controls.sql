alter table public.inference_jobs
  add column if not exists variation_mode text not null default 'balanced',
  add column if not exists seed integer;

alter table public.inference_jobs
  drop constraint if exists inference_jobs_variation_mode_check,
  add constraint inference_jobs_variation_mode_check
    check (variation_mode in ('preserve','balanced','new-scene'));

alter table public.inference_jobs
  drop constraint if exists inference_jobs_seed_check,
  add constraint inference_jobs_seed_check
    check (seed is null or (seed >= 0 and seed <= 2147483647));
