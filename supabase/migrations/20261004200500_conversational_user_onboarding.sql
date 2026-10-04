create table if not exists public.cooperative_user_profile_fields (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
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
  source_kind text not null default 'onboarding',
  first_known_at timestamptz,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_ref, field_key)
);

create index if not exists cooperative_user_profile_fields_owner_status_idx
  on public.cooperative_user_profile_fields(owner_ref,status,category,updated_at desc);

alter table public.cooperative_user_profile_fields enable row level security;

create table if not exists public.cooperative_onboarding_sessions (
  owner_ref text primary key,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','completed','dismissed')),
  current_batch integer not null default 0,
  conversation_id uuid references public.local_ai_conversations(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.cooperative_onboarding_sessions enable row level security;
