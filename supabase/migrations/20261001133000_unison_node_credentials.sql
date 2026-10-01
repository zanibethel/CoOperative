alter table public.unison_nodes
  add column if not exists token_hash text;

create table if not exists public.unison_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (char_length(code_hash) = 64),
  owner_ref text not null check (char_length(owner_ref) between 1 and 160),
  node_class text not null default 'private'
    check (node_class in ('private','business','community')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_node_id text,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

alter table public.unison_pairing_codes enable row level security;
revoke all on table public.unison_pairing_codes from anon, authenticated;
grant all on table public.unison_pairing_codes to service_role;

create index if not exists unison_pairing_codes_expiry_idx
  on public.unison_pairing_codes(expires_at)
  where claimed_at is null;

create or replace function public.claim_unison_pairing_code(
  p_code_hash text,
  p_node_id text,
  p_display_name text,
  p_token_hash text
)
returns table(owner_ref text, node_class text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair public.unison_pairing_codes%rowtype;
begin
  select *
  into v_pair
  from public.unison_pairing_codes
  where code_hash = p_code_hash
    and claimed_at is null
    and expires_at > now()
  for update;

  if not found then
    return;
  end if;

  insert into public.unison_nodes (
    id,
    display_name,
    owner_ref,
    node_class,
    state,
    platform,
    capabilities,
    resources,
    policy,
    worker_version,
    token_hash,
    first_seen_at,
    last_seen_at,
    created_at,
    updated_at
  )
  values (
    left(p_node_id, 160),
    left(p_display_name, 160),
    v_pair.owner_ref,
    v_pair.node_class,
    'online',
    '{}'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    'paired',
    p_token_hash,
    now(),
    now(),
    now(),
    now()
  );

  update public.unison_pairing_codes
  set claimed_at = now(),
      claimed_node_id = left(p_node_id, 160)
  where id = v_pair.id;

  return query
  select v_pair.owner_ref, v_pair.node_class;
end;
$$;

revoke all on function public.claim_unison_pairing_code(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_unison_pairing_code(text, text, text, text)
  to service_role;
