alter table public.recovery_incidents
  add column if not exists personal_conversation_id uuid
    references public.personal_ai_conversations(id) on delete cascade;

create index if not exists recovery_incidents_personal_conversation_created_idx
  on public.recovery_incidents(personal_conversation_id, created_at desc);
