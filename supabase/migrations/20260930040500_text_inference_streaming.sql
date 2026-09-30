alter table public.text_inference_jobs
  add column if not exists partial_text text,
  add column if not exists first_token_ms integer,
  add column if not exists progress_at timestamptz;

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_first_token_ms_check,
  add constraint text_inference_jobs_first_token_ms_check
    check (first_token_ms is null or first_token_ms >= 0);
