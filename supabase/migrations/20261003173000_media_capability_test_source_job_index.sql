create index if not exists media_model_capability_tests_source_job_idx
  on public.media_model_capability_tests (source_job_id)
  where source_job_id is not null;
