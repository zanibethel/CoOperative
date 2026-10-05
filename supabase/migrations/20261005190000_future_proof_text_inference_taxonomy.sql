alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_task_class_check;

alter table public.text_inference_jobs
  add constraint text_inference_jobs_task_class_check
  check (task_class ~ '^[a-z][a-z0-9-]{0,63}$')
  not valid;

alter table public.text_inference_jobs
  validate constraint text_inference_jobs_task_class_check;

comment on column public.text_inference_jobs.task_class is
  'Extensible application taxonomy key. Semantics are owned by CoOperative code; the database only enforces a safe lowercase kebab-case identifier so new task classes do not require a schema migration.';

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_routing_mode_check;

alter table public.text_inference_jobs
  add constraint text_inference_jobs_routing_mode_check
  check (routing_mode ~ '^[a-z][a-z0-9-]{0,63}$')
  not valid;

alter table public.text_inference_jobs
  validate constraint text_inference_jobs_routing_mode_check;

comment on column public.text_inference_jobs.routing_mode is
  'Extensible application routing key. Semantics are owned by CoOperative routing code; the database only enforces a safe lowercase kebab-case identifier so new routing modes do not require a schema migration.';
