-- CoOperative deployed core schema v0.1
-- Reference SQL for the currently deployed Supabase foundation.
-- Future Capability Registry / Playbook / Improvement Lab tables are intentionally
-- deferred until the core auth + tenant + assessment flow is proven.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organizations_owner_user_id_idx
  on public.organizations(owner_user_id);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  industry text not null default '',
  team_size integer not null default 1 check (team_size > 0),
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_id_organization_id_unique unique (id, organization_id)
);

create index if not exists businesses_organization_id_idx
  on public.businesses(organization_id);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'completed' check (status in ('draft', 'completed', 'archived')),
  analyzer_version text not null default 'deterministic-v0.1',
  intake jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessments_business_id_fkey foreign key (business_id)
    references public.businesses(id) on delete cascade,
  constraint assessments_business_org_fk foreign key (business_id, organization_id)
    references public.businesses(id, organization_id) on delete cascade
);

create index if not exists assessments_organization_id_idx
  on public.assessments(organization_id);
create index if not exists assessments_business_id_idx
  on public.assessments(business_id);
create index if not exists assessments_created_by_idx
  on public.assessments(created_by);
create index if not exists assessments_business_org_idx
  on public.assessments(business_id, organization_id);

alter table public.organizations enable row level security;
alter table public.businesses enable row level security;
alter table public.assessments enable row level security;

revoke all on table public.organizations from anon;
revoke all on table public.businesses from anon;
revoke all on table public.assessments from anon;

grant select, insert, update, delete on table public.organizations to authenticated;
grant select, insert, update, delete on table public.businesses to authenticated;
grant select, insert, update, delete on table public.assessments to authenticated;

create policy "owners_select_organizations"
on public.organizations for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "owners_insert_organizations"
on public.organizations for insert
to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy "owners_update_organizations"
on public.organizations for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy "owners_delete_organizations"
on public.organizations for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "owners_select_businesses"
on public.businesses for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_businesses"
on public.businesses for insert
to authenticated
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_update_businesses"
on public.businesses for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_businesses"
on public.businesses for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_select_assessments"
on public.assessments for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_assessments"
on public.assessments for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id
      and o.owner_user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.businesses b
    where b.id = business_id
      and b.organization_id = organization_id
  )
);

create policy "owners_update_assessments"
on public.assessments for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_assessments"
on public.assessments for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id
    and o.owner_user_id = (select auth.uid())
));
