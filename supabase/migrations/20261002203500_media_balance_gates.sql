alter table public.media_generation_jobs
  add column if not exists ai_balance_reservation_id uuid
    references public.ai_profile_balance_reservations(id) on delete set null,
  add column if not exists billing_mode text,
  add column if not exists billed_microusd bigint;

alter table public.media_generation_jobs
  drop constraint if exists media_generation_jobs_billing_mode_check;

alter table public.media_generation_jobs
  add constraint media_generation_jobs_billing_mode_check
  check (
    billing_mode is null or
    billing_mode in ('nous-subscription','openrouter-byok','cooperative-balance','local')
  );

create index if not exists media_generation_jobs_balance_reservation_idx
  on public.media_generation_jobs(ai_balance_reservation_id)
  where ai_balance_reservation_id is not null;
