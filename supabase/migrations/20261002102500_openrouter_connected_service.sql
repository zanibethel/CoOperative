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
  'openrouter-api',
  'OpenRouter API',
  'ai',
  'api',
  'available',
  'none',
  'public',
  'https://openrouter.ai',
  'Connect an OpenRouter API key once. CoOperative can use it for text, image, and video provider access while keeping the credential in the server-side vault.',
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
