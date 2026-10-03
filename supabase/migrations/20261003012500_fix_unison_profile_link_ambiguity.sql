-- Fix ambiguity between RETURNS TABLE output variables and table columns
-- in the shared-node Windows-profile linking RPC.

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
  on conflict on constraint unison_node_users_pkey do update
  set role = case
        when public.unison_node_users.role = 'owner' then 'owner'
        else excluded.role
      end,
      status = 'active',
      updated_at = now();

  update public.unison_node_profile_tokens as tokens
  set revoked_at = now()
  where tokens.node_id = v_node.id
    and tokens.user_id = p_user_id
    and tokens.revoked_at is null;

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

  update public.unison_node_link_challenges as challenges
  set claimed_at = now(),
      claimed_user_id = p_user_id
  where challenges.id = v_challenge.id;

  return query
  select
    v_node.id,
    (
      select unu.role
      from public.unison_node_users as unu
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
