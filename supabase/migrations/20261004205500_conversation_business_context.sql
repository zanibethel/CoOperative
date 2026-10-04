alter table public.local_ai_conversations
  add column if not exists business_id uuid references public.businesses(id) on delete set null;

create index if not exists local_ai_conversations_owner_business_idx
  on public.local_ai_conversations(owner_ref,business_id,updated_at desc);
