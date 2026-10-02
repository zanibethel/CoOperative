-- Multi-user access for one physical Unison node.
-- The contributor_user_id remains the device owner / earnings owner.
-- unison_node_users controls who may use the node for private Personal AI.

create table if not exists public.unison_node_users (
  node_id text not null references public.unison_nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  status text not null default 'active'
    check (status in ('active','revoked')),
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (node_id, user_id)
);

create index if not exists unison_node_users_user_status_idx
  on public.unison_node_users(user_id, status, linked_at desc);

create index if not exists unison_node_users_node_status_idx
  on public.unison_node_users(node_id, status, role);

alter table public.unison_node_users enable row level security;
revoke all on table public.unison_node_users from anon, authenticated;
grant all on table public.unison_node_users to service_role;

insert into public.unison_node_users(node_id, user_id, role, status)
select id, contributor_user_id, 'owner', 'active'
from public.unison_nodes
where contributor_user_id is not null
on conflict (node_id, user_id) do update
set role = 'owner',
    status = 'active',
    updated_at = now();

create table if not exists public.unison_node_link_challenges (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references public.unison_nodes(id) on delete cascade,
  proof_hash text not null unique check (char_length(proof_hash) = 64),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists unison_node_link_challenges_expiry_idx
  on public.unison_node_link_challenges(expires_at)
  where claimed_at is null;

alter table public.unison_node_link_challenges enable row level security;
revoke all on table public.unison_node_link_challenges from anon, authenticated;
grant all on table public.unison_node_link_challenges to service_role;

create table if not exists public.unison_node_profile_tokens (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references public.unison_nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists unison_node_profile_tokens_user_idx
  on public.unison_node_profile_tokens(user_id, node_id, created_at desc);

create index if not exists unison_node_profile_tokens_active_idx
  on public.unison_node_profile_tokens(node_id, user_id)
  where revoked_at is null;

alter table public.unison_node_profile_tokens enable row level security;
revoke all on table public.unison_node_profile_tokens from anon, authenticated;
grant all on table public.unison_node_profile_tokens to service_role;

create or replace function public.claim_unison_node_user_link(
  p_proof_hash text,
  p_user_id uuid,
  p_profile_token_hash text
)
returns table(node_id text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.unison_node_link_challenges%rowtype;
  v_node public.unison_nodes%rowtype;
  v_role text;
begin
  select *
    into v_challenge
  from public.unison_node_link_challenges
  where proof_hash = p_proof_hash
    and claimed_at is null
    and expires_at > now()
  for update;

  if not found then
    return;
  end if;

  select *
    into v_node
  from public.unison_nodes
  where id = v_challenge.node_id
  for update;

  if not found then
    return;
  end if;

  v_role := case
    when v_node.contributor_user_id = p_user_id then 'owner'
    else 'member'
  end;

  insert into public.unison_node_users(
    node_id,
    user_id,
    role,
    status,
    linked_at,
    updated_at
  )
  values (
    v_node.id,
    p_user_id,
    v_role,
    'active',
    now(),
    now()
  )
  on conflict (node_id, user_id) do update
  set role = case
        when public.unison_node_users.role = 'owner' then 'owner'
        else excluded.role
      end,
      status = 'active',
      updated_at = now();

  update public.unison_node_profile_tokens
  set revoked_at = now()
  where node_id = v_node.id
    and user_id = p_user_id
    and revoked_at is null;

  insert into public.unison_node_profile_tokens(
    node_id,
    user_id,
    token_hash
  )
  values (
    v_node.id,
    p_user_id,
    p_profile_token_hash
  );

  update public.unison_node_link_challenges
  set claimed_at = now(),
      claimed_user_id = p_user_id
  where id = v_challenge.id;

  return query
  select
    v_node.id,
    (
      select unu.role
      from public.unison_node_users unu
      where unu.node_id = v_node.id
        and unu.user_id = p_user_id
      limit 1
    );
end;
$$;

revoke all on function public.claim_unison_node_user_link(text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_unison_node_user_link(text,uuid,text)
  to service_role;
