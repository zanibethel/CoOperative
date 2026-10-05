create unique index if not exists ai_model_scan_runs_one_running
  on public.ai_model_scan_runs ((1))
  where status='running';

comment on index public.ai_model_scan_runs_one_running is
  'Prevents concurrent model capability scans from racing registry change detection.';
