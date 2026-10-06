-- Backfill legacy platform-private Unison nodes that predate multi-user access.
-- In installations with a single platform owner, these nodes belong to that owner
-- and should participate in Personal AI routing like newly paired nodes.

with platform_owner as (
  select user_id
  from public.unison_platform_owners
  order by created_at asc
  limit 1
),
legacy_nodes as (
  update public.unison_nodes n
  set contributor_user_id = o.user_id,
      updated_at = now()
  from platform_owner o
  where n.owner_ref = 'platform-private'
    and n.contributor_user_id is null
  returning n.id, o.user_id
)
insert into public.unison_node_users(
  node_id,
  user_id,
  role,
  status,
  linked_at,
  updated_at
)
select
  id,
  user_id,
  'owner',
  'active',
  now(),
  now()
from legacy_nodes
on conflict (node_id, user_id) do update
set role = 'owner',
    status = 'active',
    updated_at = now();
