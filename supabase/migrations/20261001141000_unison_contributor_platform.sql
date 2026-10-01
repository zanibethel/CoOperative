create table if not exists public.unison_platform_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.unison_platform_owners enable row level security;
revoke all on table public.unison_platform_owners from anon, authenticated;
grant all on table public.unison_platform_owners to service_role;

insert into public.unison_platform_owners (user_id)
select distinct owner_user_id
from public.organizations
where owner_user_id is not null
on conflict (user_id) do nothing;

create table if not exists public.unison_contributors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 160),
  contact_email text not null check (char_length(contact_email) between 3 and 320),
  status text not null default 'active'
    check (status in ('active','paused','suspended')),
  payout_status text not null default 'not_configured'
    check (payout_status in ('not_configured','ready','hold')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.unison_contributors enable row level security;
revoke all on table public.unison_contributors from anon, authenticated;
grant all on table public.unison_contributors to service_role;

alter table public.unison_nodes
  add column if not exists contributor_user_id uuid references auth.users(id) on delete set null;

alter table public.unison_pairing_codes
  add column if not exists contributor_user_id uuid references auth.users(id) on delete cascade;

create index if not exists unison_nodes_contributor_idx
  on public.unison_nodes(contributor_user_id, last_seen_at desc);

create index if not exists unison_pairing_codes_contributor_idx
  on public.unison_pairing_codes(contributor_user_id, created_at desc);

create table if not exists public.unison_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  contributor_user_id uuid references auth.users(id) on delete set null,
  node_id text references public.unison_nodes(id) on delete set null,
  source_job_type text not null check (char_length(source_job_type) between 1 and 80),
  source_job_id uuid,
  status text not null check (status in ('completed','failed')),
  compute_seconds integer not null default 0 check (compute_seconds >= 0),
  gpu_seconds integer not null default 0 check (gpu_seconds >= 0),
  cpu_seconds integer not null default 0 check (cpu_seconds >= 0),
  earned_cents integer not null default 0 check (earned_cents >= 0),
  estimated_external_cost_cents integer not null default 0 check (estimated_external_cost_cents >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.unison_usage_ledger enable row level security;
revoke all on table public.unison_usage_ledger from anon, authenticated;
grant all on table public.unison_usage_ledger to service_role;

alter table public.unison_usage_ledger
  add constraint unison_usage_source_job_unique
  unique (source_job_type, source_job_id);

create index if not exists unison_usage_contributor_created_idx
  on public.unison_usage_ledger(contributor_user_id, created_at desc);

create index if not exists unison_usage_node_created_idx
  on public.unison_usage_ledger(node_id, created_at desc);

drop function if exists public.claim_unison_pairing_code(text, text, text, text);

create function public.claim_unison_pairing_code(
  p_code_hash text,
  p_node_id text,
  p_display_name text,
  p_token_hash text
)
returns table(owner_ref text, node_class text, contributor_user_id uuid)
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
    contributor_user_id,
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
    v_pair.contributor_user_id,
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
  select v_pair.owner_ref, v_pair.node_class, v_pair.contributor_user_id;
end;
$$;

revoke all on function public.claim_unison_pairing_code(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_unison_pairing_code(text, text, text, text)
  to service_role;
