-- Hosted Personal AI history + owner-node remote execution foundation.
-- Personal history is application-encrypted with a Vault-protected key.
-- Only server-side service-role functions can decrypt message/title content.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'personal_ai_history_key'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'personal_ai_history_key',
      'Server-side encryption key for hosted Personal AI conversation history'
    );
  end if;
end
$$;

create or replace function public.personal_ai_encrypt(p_plain text)
returns bytea
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where name = 'personal_ai_history_key'
  limit 1;

  if v_key is null or length(v_key) < 32 then
    raise exception 'Personal AI history encryption key is unavailable';
  end if;

  return extensions.pgp_sym_encrypt(
    coalesce(p_plain, ''),
    v_key,
    'cipher-algo=aes256, compress-algo=1'
  );
end;
$$;

create or replace function public.personal_ai_decrypt(p_cipher bytea)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  if p_cipher is null then
    return '';
  end if;

  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where name = 'personal_ai_history_key'
  limit 1;

  if v_key is null or length(v_key) < 32 then
    raise exception 'Personal AI history encryption key is unavailable';
  end if;

  return extensions.pgp_sym_decrypt(p_cipher, v_key);
end;
$$;

revoke all on function public.personal_ai_encrypt(text) from public, anon, authenticated;
revoke all on function public.personal_ai_decrypt(bytea) from public, anon, authenticated;
grant execute on function public.personal_ai_encrypt(text) to service_role;
grant execute on function public.personal_ai_decrypt(bytea) to service_role;

create table if not exists public.personal_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hosted_history_enabled boolean not null default true,
  improvement_opt_in boolean not null default false,
  remote_enabled boolean not null default true,
  preferred_node_id text null references public.unison_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_ai_settings enable row level security;

grant select, insert, update on public.personal_ai_settings to authenticated;
grant all on public.personal_ai_settings to service_role;

create policy "personal_ai_settings_select_own"
  on public.personal_ai_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "personal_ai_settings_insert_own"
  on public.personal_ai_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "personal_ai_settings_update_own"
  on public.personal_ai_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.personal_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text null references public.unison_nodes(id) on delete set null,
  title_ciphertext bytea not null,
  source text not null default 'mobile'
    check (source in ('mobile','web','desktop')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_ai_conversations_user_updated_idx
  on public.personal_ai_conversations(user_id, updated_at desc);

alter table public.personal_ai_conversations enable row level security;
grant all on public.personal_ai_conversations to service_role;

create table if not exists public.personal_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.personal_ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content_ciphertext bytea not null,
  source_job_id uuid null references public.text_inference_jobs(id) on delete set null,
  source text not null default 'mobile'
    check (source in ('mobile','web','desktop','node')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create unique index if not exists personal_ai_messages_job_role_uidx
  on public.personal_ai_messages(source_job_id, role)
  where source_job_id is not null;

create index if not exists personal_ai_messages_conversation_created_idx
  on public.personal_ai_messages(conversation_id, created_at asc);

alter table public.personal_ai_messages enable row level security;
grant all on public.personal_ai_messages to service_role;

create or replace function public.personal_ai_create_conversation(
  p_user_id uuid,
  p_node_id text,
  p_title text,
  p_source text default 'mobile'
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.personal_ai_conversations(
    id, user_id, node_id, title_ciphertext, source
  ) values (
    v_id,
    p_user_id,
    p_node_id,
    public.personal_ai_encrypt(left(coalesce(nullif(trim(p_title), ''), 'New chat'), 160)),
    case when p_source in ('mobile','web','desktop') then p_source else 'mobile' end
  );
  return v_id;
end;
$$;

create or replace function public.personal_ai_append_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_content text,
  p_source text default 'mobile',
  p_source_job_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1
    from public.personal_ai_conversations
    where id = p_conversation_id and user_id = p_user_id
  ) then
    raise exception 'Personal AI conversation not found';
  end if;

  if p_role not in ('user','assistant') then
    raise exception 'Invalid Personal AI message role';
  end if;

  insert into public.personal_ai_messages(
    id,
    conversation_id,
    user_id,
    role,
    content_ciphertext,
    source_job_id,
    source,
    metadata
  ) values (
    v_id,
    p_conversation_id,
    p_user_id,
    p_role,
    public.personal_ai_encrypt(coalesce(p_content, '')),
    p_source_job_id,
    case when p_source in ('mobile','web','desktop','node') then p_source else 'mobile' end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_job_id, role)
    where source_job_id is not null
  do update set
    content_ciphertext = excluded.content_ciphertext,
    metadata = excluded.metadata;

  update public.personal_ai_conversations
  set updated_at = now()
  where id = p_conversation_id and user_id = p_user_id;

  return v_id;
end;
$$;

create or replace function public.personal_ai_list_conversations(p_user_id uuid)
returns table(
  id uuid,
  node_id text,
  title text,
  source text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, vault, extensions
as $$
  select
    c.id,
    c.node_id,
    public.personal_ai_decrypt(c.title_ciphertext) as title,
    c.source,
    c.created_at,
    c.updated_at
  from public.personal_ai_conversations c
  where c.user_id = p_user_id
  order by c.updated_at desc
  limit 100;
$$;

create or replace function public.personal_ai_read_messages(
  p_user_id uuid,
  p_conversation_id uuid
)
returns table(
  id uuid,
  role text,
  content text,
  source_job_id uuid,
  source text,
  metadata jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public, vault, extensions
as $$
  select
    m.id,
    m.role,
    public.personal_ai_decrypt(m.content_ciphertext) as content,
    m.source_job_id,
    m.source,
    m.metadata,
    m.created_at
  from public.personal_ai_messages m
  where m.user_id = p_user_id
    and m.conversation_id = p_conversation_id
  order by m.created_at asc;
$$;

revoke all on function public.personal_ai_create_conversation(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.personal_ai_append_message(uuid,uuid,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.personal_ai_list_conversations(uuid) from public, anon, authenticated;
revoke all on function public.personal_ai_read_messages(uuid,uuid) from public, anon, authenticated;

grant execute on function public.personal_ai_create_conversation(uuid,text,text,text) to service_role;
grant execute on function public.personal_ai_append_message(uuid,uuid,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.personal_ai_list_conversations(uuid) to service_role;
grant execute on function public.personal_ai_read_messages(uuid,uuid) to service_role;

alter table public.text_inference_jobs
  add column if not exists personal_use boolean not null default false,
  add column if not exists personal_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists personal_conversation_id uuid null
    references public.personal_ai_conversations(id) on delete set null;

alter table public.text_inference_jobs
  drop constraint if exists text_inference_jobs_personal_use_check;

alter table public.text_inference_jobs
  add constraint text_inference_jobs_personal_use_check
  check (
    personal_use = false
    or (
      personal_user_id is not null
      and personal_conversation_id is not null
      and target_node_id is not null
    )
  );

create index if not exists text_inference_jobs_personal_queue_idx
  on public.text_inference_jobs(target_node_id, created_at)
  where status = 'queued' and personal_use = true;

create or replace function public.claim_next_personal_text_inference_job(
  p_worker_id text,
  p_node_id text
)
returns setof public.text_inference_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.text_inference_jobs
  set status = 'queued',
      worker_id = null,
      claimed_at = null,
      updated_at = now(),
      error = coalesce(error, 'Previous personal worker lease expired; job was requeued.')
  where status = 'running'
    and personal_use = true
    and target_node_id = p_node_id
    and claimed_at < now() - interval '20 minutes';

  select id into v_id
  from public.text_inference_jobs
  where status = 'queued'
    and personal_use = true
    and target_node_id = p_node_id
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.text_inference_jobs
  set status = 'running',
      worker_id = left(coalesce(p_worker_id, 'personal-text-worker'), 160),
      claimed_at = now(),
      updated_at = now(),
      error = null
  where id = v_id;

  return query
  select *
  from public.text_inference_jobs
  where id = v_id;
end;
$$;

revoke all on function public.claim_next_personal_text_inference_job(text,text)
  from public, anon, authenticated;
grant execute on function public.claim_next_personal_text_inference_job(text,text)
  to service_role;
