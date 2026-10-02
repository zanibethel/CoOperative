alter table public.text_inference_jobs
  add column if not exists model_mixer jsonb,
  add column if not exists request_max_spend_microusd bigint;

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_request_max_spend_microusd_check,
  add constraint text_inference_jobs_request_max_spend_microusd_check
    check (
      request_max_spend_microusd is null
      or request_max_spend_microusd between 0 and 100000000
    );

create index if not exists text_inference_jobs_request_spend_cap_idx
  on public.text_inference_jobs(request_max_spend_microusd)
  where request_max_spend_microusd is not null;
