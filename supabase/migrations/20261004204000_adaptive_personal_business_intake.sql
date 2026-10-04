alter table public.cooperative_onboarding_sessions
  add column if not exists mode text not null default 'choose',
  add column if not exists phase text not null default 'choose_mode',
  add column if not exists business_id uuid references public.businesses(id) on delete set null,
  add column if not exists draft jsonb not null default '{}'::jsonb,
  add column if not exists last_question_keys jsonb not null default '[]'::jsonb,
  add column if not exists paused_reason text;

create table if not exists public.cooperative_business_profile_fields (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  field_key text not null,
  category text not null,
  label text not null,
  value_text text,
  status text not null default 'unknown'
    check (status in ('known','unknown','deferred')),
  confidence numeric(4,3) not null default 1.0
    check (confidence >= 0 and confidence <= 1),
  source_conversation_id uuid references public.local_ai_conversations(id) on delete set null,
  source_message_id uuid references public.local_ai_messages(id) on delete set null,
  source_kind text not null default 'business-intake',
  first_known_at timestamptz,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_ref,business_id,field_key)
);

create index if not exists cooperative_business_profile_fields_owner_business_idx
  on public.cooperative_business_profile_fields(owner_ref,business_id,status,category,updated_at desc);

alter table public.cooperative_business_profile_fields enable row level security;

alter table public.text_inference_jobs
  add column if not exists business_id uuid references public.businesses(id) on delete set null;
