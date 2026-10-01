create table if not exists public.unison_nodes (
  id text primary key check (char_length(id) between 1 and 160),
  display_name text not null check (char_length(display_name) between 1 and 160),
  owner_ref text not null default 'platform-private' check (char_length(owner_ref) between 1 and 160),
  node_class text not null default 'private'
    check (node_class in ('private','business','community')),
  state text not null default 'online'
    check (state in ('online','idle','busy','paused')),
  platform jsonb not null default '{}'::jsonb
    check (jsonb_typeof(platform) = 'object'),
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array'),
  resources jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resources) = 'object'),
  policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy) = 'object'),
  worker_version text not null default 'unknown'
    check (char_length(worker_version) between 1 and 80),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.unison_nodes enable row level security;
revoke all on table public.unison_nodes from anon, authenticated;
grant all on table public.unison_nodes to service_role;

create index if not exists unison_nodes_last_seen_idx
  on public.unison_nodes(last_seen_at desc);

create index if not exists unison_nodes_owner_class_idx
  on public.unison_nodes(owner_ref, node_class);
