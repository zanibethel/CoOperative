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
values
  (
    'openai-api',
    'OpenAI API',
    'ai',
    'api',
    'available',
    'none',
    'public',
    'https://platform.openai.com',
    'Connect an API-capable OpenAI project/service account. Consumer ChatGPT subscriptions are tracked separately and do not supply API credentials.',
    now(),
    now()
  ),
  (
    'anthropic-claude',
    'Claude API',
    'ai',
    'api',
    'available',
    'none',
    'public',
    'https://platform.claude.com',
    'Connect a Claude Platform API key. Workload Identity Federation can be added for enterprise deployments.',
    now(),
    now()
  ),
  (
    'google-gemini',
    'Gemini API',
    'ai',
    'api',
    'available',
    'none',
    'public',
    'https://ai.google.dev',
    'Connect a Gemini API key/auth key associated with the business Google Cloud project.',
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

create or replace function public.store_connected_service_credential(
  p_service_id uuid,
  p_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference uuid;
begin
  if p_secret is null or char_length(trim(p_secret)) < 8 then
    raise exception 'credential is missing or too short';
  end if;

  select nullif(credential_reference, '')::uuid
  into v_reference
  from public.connected_services
  where id = p_service_id
  for update;

  if not found then
    raise exception 'connected service not found';
  end if;

  if v_reference is null then
    v_reference := vault.create_secret(
      p_secret,
      null,
      'CoOperative connected service credential ' || p_service_id::text
    );
  else
    perform vault.update_secret(v_reference, p_secret);
  end if;

  update public.connected_services
  set
    credential_reference = v_reference::text,
    connection_status = 'connected',
    updated_at = now()
  where id = p_service_id;

  return v_reference::text;
end;
$$;

revoke all on function public.store_connected_service_credential(uuid, text)
from public, anon, authenticated;
grant execute on function public.store_connected_service_credential(uuid, text)
to service_role;

create or replace function public.read_connected_service_credential(
  p_service_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference uuid;
  v_secret text;
begin
  select nullif(credential_reference, '')::uuid
  into v_reference
  from public.connected_services
  where id = p_service_id;

  if not found or v_reference is null then
    return null;
  end if;

  select decrypted_secret
  into v_secret
  from vault.decrypted_secrets
  where id = v_reference;

  return v_secret;
end;
$$;

revoke all on function public.read_connected_service_credential(uuid)
from public, anon, authenticated;
grant execute on function public.read_connected_service_credential(uuid)
to service_role;

create or replace function public.clear_connected_service_credential(
  p_service_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference uuid;
begin
  select nullif(credential_reference, '')::uuid
  into v_reference
  from public.connected_services
  where id = p_service_id
  for update;

  if not found then
    return false;
  end if;

  if v_reference is not null then
    delete from vault.secrets where id = v_reference;
  end if;

  update public.connected_services
  set
    credential_reference = null,
    connection_status = 'disconnected',
    updated_at = now()
  where id = p_service_id;

  return true;
end;
$$;

revoke all on function public.clear_connected_service_credential(uuid)
from public, anon, authenticated;
grant execute on function public.clear_connected_service_credential(uuid)
to service_role;
