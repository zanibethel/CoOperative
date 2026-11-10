-- Per-user external account authorization. No token or flow is client-readable.
create table if not exists public.user_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  provider_account_id text not null,
  account_label text,
  credential_reference uuid,
  granted_scopes text[] not null default '{}',
  connection_status text not null default 'connected'
    check (connection_status in ('connected','reconnect-required','disconnected')),
  expires_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_key, provider_account_id)
);

create index if not exists user_oauth_connections_owner_idx
  on public.user_oauth_connections (user_id, provider_key, updated_at desc);
alter table public.user_oauth_connections enable row level security;
revoke all on public.user_oauth_connections from public, anon, authenticated;
grant all on public.user_oauth_connections to service_role;

create table if not exists public.user_oauth_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  state_hash text not null unique,
  pkce_verifier text,
  status text not null default 'pending'
    check (status in ('pending','approved','failed','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_oauth_flows_owner_idx
  on public.user_oauth_flows (user_id, provider_key, created_at desc);
alter table public.user_oauth_flows enable row level security;
revoke all on public.user_oauth_flows from public, anon, authenticated;
grant all on public.user_oauth_flows to service_role;

create table if not exists public.user_oauth_refresh_leases (
  connection_id uuid primary key references public.user_oauth_connections(id) on delete cascade,
  lease_token uuid not null,
  expires_at timestamptz not null
);
alter table public.user_oauth_refresh_leases enable row level security;
revoke all on public.user_oauth_refresh_leases from public, anon, authenticated;
grant all on public.user_oauth_refresh_leases to service_role;

-- The only read/write entrypoints for decrypted grants are service-role-only.
create or replace function public.store_user_oauth_grant(
  p_user_id uuid,
  p_provider_key text,
  p_provider_account_id text,
  p_account_label text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scopes text[]
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_ref uuid;
  v_prior jsonb;
  v_refresh text;
  v_document jsonb;
begin
  if p_user_id is null or length(coalesce(p_provider_key, '')) < 2
    or length(coalesce(p_provider_account_id, '')) < 1
    or length(coalesce(p_access_token, '')) < 8 then
    raise exception 'invalid oauth grant';
  end if;

  insert into public.user_oauth_connections
    (user_id, provider_key, provider_account_id, account_label, granted_scopes,
     expires_at, connection_status, last_verified_at)
  values
    (p_user_id, p_provider_key, p_provider_account_id, p_account_label,
     coalesce(p_scopes, '{}'), p_expires_at, 'connected', now())
  on conflict (user_id, provider_key, provider_account_id) do update
    set account_label = excluded.account_label,
        granted_scopes = excluded.granted_scopes,
        expires_at = excluded.expires_at,
        connection_status = 'connected',
        last_verified_at = now(),
        updated_at = now()
  returning id into v_id;

  select credential_reference into v_ref from public.user_oauth_connections
    where id = v_id for update;

  if v_ref is not null then
    select decrypted_secret::jsonb into v_prior
      from vault.decrypted_secrets where id = v_ref;
  end if;
  v_refresh := coalesce(nullif(p_refresh_token, ''), v_prior ->> 'refresh_token');
  v_document := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', v_refresh
  );
  if v_ref is null then
    v_ref := vault.create_secret(v_document::text, null,
      'CoOperative per-user OAuth connection ' || v_id::text);
  else
    perform vault.update_secret(v_ref, v_document::text);
  end if;

  update public.user_oauth_connections set
    credential_reference = v_ref, updated_at = now() where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.store_user_oauth_grant(uuid,text,text,text,text,text,timestamptz,text[])
  from public, anon, authenticated;
grant execute on function public.store_user_oauth_grant(uuid,text,text,text,text,text,timestamptz,text[])
  to service_role;

create or replace function public.read_user_oauth_grant(p_connection_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_document jsonb;
begin
  select s.decrypted_secret::jsonb into v_document
    from public.user_oauth_connections c
    join vault.decrypted_secrets s on s.id = c.credential_reference
    where c.id = p_connection_id and c.connection_status = 'connected';
  return v_document;
end;
$$;
revoke all on function public.read_user_oauth_grant(uuid) from public, anon, authenticated;
grant execute on function public.read_user_oauth_grant(uuid) to service_role;

create or replace function public.disconnect_user_oauth_grant(p_connection_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_ref uuid;
begin
  select credential_reference into v_ref from public.user_oauth_connections
    where id = p_connection_id for update;
  if not found then return false; end if;
  if v_ref is not null then
    delete from vault.secrets where id = v_ref;
  end if;
  update public.user_oauth_connections
    set credential_reference = null, connection_status = 'disconnected',
        updated_at = now() where id = p_connection_id;
  return true;
end;
$$;
revoke all on function public.disconnect_user_oauth_grant(uuid) from public, anon, authenticated;
grant execute on function public.disconnect_user_oauth_grant(uuid) to service_role;

create or replace function public.try_acquire_user_oauth_refresh_lease(
  p_connection_id uuid, p_lease_token uuid
) returns boolean language sql security definer set search_path = ''
as $$
  with claimed as (
    insert into public.user_oauth_refresh_leases(connection_id, lease_token, expires_at)
    values (p_connection_id, p_lease_token, now() + interval '30 seconds')
    on conflict (connection_id) do update set
      lease_token = excluded.lease_token, expires_at = excluded.expires_at
    where public.user_oauth_refresh_leases.expires_at < now()
    returning 1
  )
  select exists (select 1 from claimed);
$$;
revoke all on function public.try_acquire_user_oauth_refresh_lease(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.try_acquire_user_oauth_refresh_lease(uuid,uuid)
  to service_role;

create or replace function public.release_user_oauth_refresh_lease(
  p_connection_id uuid, p_lease_token uuid
) returns void language sql security definer set search_path = ''
as $$
  delete from public.user_oauth_refresh_leases
   where connection_id = p_connection_id and lease_token = p_lease_token;
$$;
revoke all on function public.release_user_oauth_refresh_lease(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.release_user_oauth_refresh_lease(uuid,uuid)
  to service_role;