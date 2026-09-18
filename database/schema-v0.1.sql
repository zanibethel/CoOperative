-- CoOperative deployed core schema v0.1
-- Reference SQL for the currently deployed Supabase foundation.
-- Core auth + tenant + assessment persistence is deployed.
-- Phase 2 adds the governed Capability Registry and Playbook catalog below.

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


-- Phase 2: governed capability registry.
create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null unique check (capability_key ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 2 and 120),
  provider text not null,
  category text not null check (category in (
    'communication','calendar','crm','payments','accounting','social',
    'website','automation','ai','storage','research','other'
  )),
  delivery text not null check (delivery in (
    'native','plugin','api','webhook','workflow-engine','agent','manual'
  )),
  audience text not null default 'customer' check (audience in ('customer','platform')),
  auth_mode text not null check (auth_mode in (
    'oauth','api-key','service-account','none','local-approval','unknown'
  )),
  estimated_cost_model text not null default 'unknown',
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high')),
  status text not null default 'research' check (status in ('research','approved','deprecated')),
  notes text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.capabilities enable row level security;
revoke all on public.capabilities from anon;
revoke all on public.capabilities from authenticated;
grant select on public.capabilities to authenticated;

create policy "authenticated users can view approved customer capabilities"
on public.capabilities
for select
to authenticated
using (status = 'approved' and audience = 'customer');

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  playbook_key text not null check (playbook_key ~ '^[a-z0-9-]+$'),
  version integer not null check (version > 0),
  name text not null,
  problem_pattern text not null,
  prerequisites jsonb not null default '[]'::jsonb check (jsonb_typeof(prerequisites) = 'array'),
  required_capability_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(required_capability_keys) = 'array'),
  human_approval_required boolean not null default true,
  status text not null default 'draft' check (status in ('draft','validated','published','retired')),
  evidence_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playbook_key, version)
);

alter table public.playbooks enable row level security;
revoke all on public.playbooks from anon;
revoke all on public.playbooks from authenticated;
grant select on public.playbooks to authenticated;

create policy "authenticated users can view published playbooks"
on public.playbooks
for select
to authenticated
using (status = 'published');


-- Phase 2: customer's existing software stack and cost map.
create table if not exists public.service_providers (
  provider_key text primary key check (provider_key ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 2 and 120),
  category text not null default 'other',
  connection_method text not null default 'manual'
    check (connection_method in ('oauth','api','import','guided','browser','manual')),
  connection_status text not null default 'research'
    check (connection_status in ('research','available','limited','unavailable')),
  native_replacement_status text not null default 'none'
    check (native_replacement_status in ('none','planned','partial','available')),
  visibility text not null default 'public'
    check (visibility in ('public','internal')),
  website_url text,
  notes text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_providers enable row level security;
revoke all on public.service_providers from anon;
revoke all on public.service_providers from authenticated;
grant select on public.service_providers to authenticated;

create policy "authenticated users can view public service providers"
on public.service_providers for select
to authenticated
using (visibility = 'public');

create table if not exists public.connected_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_key text references public.service_providers(provider_key) on delete set null,
  service_name text not null check (char_length(service_name) between 2 and 160),
  external_account_label text,
  connection_method text not null default 'manual'
    check (connection_method in ('oauth','api','import','guided','browser','manual')),
  connection_status text not null default 'manual'
    check (connection_status in ('not-connected','manual','connected','syncing','error','disconnected')),
  monthly_cost_cents integer not null default 0 check (monthly_cost_cents >= 0),
  billing_frequency text not null default 'monthly'
    check (billing_frequency in ('free','monthly','annual','usage','unknown')),
  currency text not null default 'USD' check (char_length(currency) = 3),
  features_used jsonb not null default '[]'::jsonb check (jsonb_typeof(features_used) = 'array'),
  data_available jsonb not null default '[]'::jsonb check (jsonb_typeof(data_available) = 'array'),
  permissions jsonb not null default '[]'::jsonb check (jsonb_typeof(permissions) = 'array'),
  replacement_goal text not null default 'unsure'
    check (replacement_goal in ('keep','optimize','mirror','replace','unsure')),
  native_coverage_percent integer not null default 0 check (native_coverage_percent between 0 and 100),
  replacement_readiness_percent integer not null default 0 check (replacement_readiness_percent between 0 and 100),
  estimated_monthly_savings_cents integer not null default 0 check (estimated_monthly_savings_cents >= 0),
  notes text,
  credential_reference text,
  created_by uuid not null references auth.users(id) on delete cascade,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists connected_services_organization_id_idx on public.connected_services(organization_id);
create index if not exists connected_services_provider_key_idx on public.connected_services(provider_key);
create index if not exists connected_services_replacement_goal_idx on public.connected_services(organization_id, replacement_goal);
create index if not exists connected_services_created_by_idx on public.connected_services(created_by);

alter table public.connected_services enable row level security;
revoke all on public.connected_services from anon;
revoke all on public.connected_services from authenticated;
grant select, insert, update, delete on public.connected_services to authenticated;

create policy "owners_select_connected_services"
on public.connected_services for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_insert_connected_services"
on public.connected_services for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_user_id = (select auth.uid())
  )
);

create policy "owners_update_connected_services"
on public.connected_services for update
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "owners_delete_connected_services"
on public.connected_services for delete
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));
