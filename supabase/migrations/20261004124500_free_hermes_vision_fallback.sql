alter table public.text_inference_jobs
  add column if not exists fallback_provider text,
  add column if not exists fallback_model text,
  add column if not exists fallback_sandbox_name text,
  add column if not exists fallback_deadline_at timestamptz,
  add column if not exists fallback_attempted_at timestamptz,
  add column if not exists fallback_usage jsonb;
