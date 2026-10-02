insert into public.service_providers (
  provider_key,
  name,
  category,
  connection_method,
  connection_status,
  native_replacement_status,
  visibility,
  website_url,
  notes,
  last_verified_at,
  updated_at
)
values (
  'nous-portal',
  'Nous Portal',
  'ai',
  'oauth',
  'available',
  'none',
  'public',
  'https://portal.nousresearch.com',
  'Connect Nous Portal with device-code OAuth. CoOperative keeps the rotating refresh grant in the server-side vault and hands ephemeral Hermes workers only short-lived access state.',
  now(),
  now()
)
on conflict (provider_key) do update
set
  name = excluded.name,
  category = excluded.category,
  connection_method = excluded.connection_method,
  connection_status = excluded.connection_status,
  native_replacement_status = excluded.native_replacement_status,
  visibility = excluded.visibility,
  website_url = excluded.website_url,
  notes = excluded.notes,
  last_verified_at = excluded.last_verified_at,
  updated_at = excluded.updated_at;

create table if not exists public.provider_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.connected_services(id) on delete cascade,
  provider_key text not null references public.service_providers(provider_key) on delete cascade,
  conversation_id uuid references public.local_ai_conversations(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','approved','expired','denied','failed','cancelled')),
  device_code text,
  user_code text,
  verification_url text,
  poll_interval_seconds integer not null default 2
    check (poll_interval_seconds between 1 and 60),
  expires_at timestamptz not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_oauth_sessions enable row level security;
revoke all on table public.provider_oauth_sessions from anon, authenticated;
grant all on table public.provider_oauth_sessions to service_role;

create index if not exists provider_oauth_sessions_owner_created_idx
  on public.provider_oauth_sessions(owner_ref, created_at desc);

create table if not exists public.connected_service_auth_leases (
  service_id uuid primary key references public.connected_services(id) on delete cascade,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.connected_service_auth_leases enable row level security;
revoke all on table public.connected_service_auth_leases from anon, authenticated;
grant all on table public.connected_service_auth_leases to service_role;

create or replace function public.try_acquire_connected_service_auth_lease(
  p_service_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.connected_service_auth_leases(
    service_id, lease_token, lease_expires_at, updated_at
  )
  values (
    p_service_id,
    p_lease_token,
    v_now + make_interval(secs => greatest(5, least(p_lease_seconds, 120))),
    v_now
  )
  on conflict (service_id) do update
  set
    lease_token = excluded.lease_token,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = excluded.updated_at
  where public.connected_service_auth_leases.lease_expires_at <= v_now;

  return exists (
    select 1
    from public.connected_service_auth_leases
    where service_id = p_service_id
      and lease_token = p_lease_token
      and lease_expires_at > v_now
  );
end;
$$;

revoke all on function public.try_acquire_connected_service_auth_lease(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function public.try_acquire_connected_service_auth_lease(uuid, uuid, integer)
to service_role;

create or replace function public.release_connected_service_auth_lease(
  p_service_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.connected_service_auth_leases
    where service_id = p_service_id
      and lease_token = p_lease_token
    returning 1
  )
  select exists(select 1 from deleted);
$$;

revoke all on function public.release_connected_service_auth_lease(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.release_connected_service_auth_lease(uuid, uuid)
to service_role;
