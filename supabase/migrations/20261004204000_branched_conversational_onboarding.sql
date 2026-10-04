alter table public.cooperative_onboarding_sessions
  drop constraint if exists cooperative_onboarding_sessions_status_check;

alter table public.cooperative_onboarding_sessions
  add constraint cooperative_onboarding_sessions_status_check
  check (status in ('not_started','in_progress','paused','completed','dismissed'));

alter table public.cooperative_onboarding_sessions
  add column if not exists mode text not null default 'choose'
    check (mode in ('choose','personal','business')),
  add column if not exists phase text not null default 'choose_mode',
  add column if not exists business_id uuid references public.businesses(id) on delete set null,
  add column if not exists draft jsonb not null default '{}'::jsonb,
  add column if not exists last_question_keys jsonb not null default '[]'::jsonb,
  add column if not exists paused_reason text;

create table if not exists public.cooperative_context_clarifications (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  conversation_id uuid not null references public.local_ai_conversations(id) on delete cascade,
  original_message text not null,
  clarification_type text not null default 'business_scope'
    check (clarification_type in ('business_scope')),
  options jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','resolved','dismissed')),
  resolved_business_id uuid references public.businesses(id) on delete set null,
  resolved_scope text check (resolved_scope in ('personal','business')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists cooperative_context_clarifications_owner_conversation_idx
  on public.cooperative_context_clarifications(owner_ref,conversation_id,status,created_at desc);

alter table public.cooperative_context_clarifications enable row level security;

alter table public.text_inference_jobs
  add column if not exists business_id uuid references public.businesses(id) on delete set null;
