alter table public.text_inference_jobs
  add column if not exists routing_mode text not null default 'manual',
  add column if not exists task_class text not null default 'general',
  add column if not exists route_reason text,
  add column if not exists allow_paid_fallback boolean not null default false,
  add column if not exists human_approval_required boolean not null default false,
  add column if not exists model_registry_revision text,
  add column if not exists verification_status text not null default 'not_run';

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_routing_mode_check,
  add constraint text_inference_jobs_routing_mode_check
    check (routing_mode in ('manual','auto','local-fast','local-quality')),
  drop constraint if exists text_inference_jobs_task_class_check,
  add constraint text_inference_jobs_task_class_check
    check (task_class in ('general','summary','planning','coding','debugging','reasoning','long-context')),
  drop constraint if exists text_inference_jobs_verification_status_check,
  add constraint text_inference_jobs_verification_status_check
    check (verification_status in ('not_run','passed','failed','needs_review'));

create index if not exists text_inference_jobs_routing_created_idx
  on public.text_inference_jobs(routing_mode, created_at desc);
