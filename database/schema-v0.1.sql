-- CoOperative schema draft v0.1
-- Reference SQL only. Do not treat this file as migration history.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  business_name text not null,
  industry text not null,
  team_size integer not null check (team_size > 0),
  customer_description text not null,
  tools text[] not null default '{}',
  cost_priority text not null default 'balanced' check (cost_priority in ('lowest-cost', 'balanced', 'best-fit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'analyzing', 'complete', 'failed')),
  intake jsonb not null,
  business_summary text,
  analyzer_version text not null default 'deterministic-v0.1',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  purpose text not null,
  sort_order integer not null default 0,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_opportunities (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  current_problem text not null,
  proposed_automation text not null,
  human_role text not null,
  estimated_hours_saved_per_month numeric(10,2) not null default 0,
  implementation_effort text not null check (implementation_effort in ('low', 'medium', 'high')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  priority_score integer not null check (priority_score between 0 and 100),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'building', 'active', 'paused')),
  created_at timestamptz not null default now()
);

create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null unique,
  name text not null,
  provider text not null,
  category text not null,
  delivery text not null,
  auth_mode text not null,
  estimated_cost_model text not null,
  actions jsonb not null default '[]'::jsonb,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  status text not null default 'research' check (status in ('research', 'approved', 'deprecated')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  playbook_key text not null,
  version integer not null check (version > 0),
  name text not null,
  problem_pattern text not null,
  prerequisites jsonb not null default '[]'::jsonb,
  required_capability_keys jsonb not null default '[]'::jsonb,
  human_approval_required boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'validated', 'published', 'retired')),
  created_at timestamptz not null default now(),
  unique (playbook_key, version)
);

create table if not exists public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  playbook_id uuid not null references public.playbooks(id) on delete restrict,
  status text not null check (status in ('planned', 'active', 'paused', 'completed', 'failed')),
  implementation_cost numeric(12,2),
  monthly_cost numeric(12,2),
  hours_saved numeric(12,2),
  human_interventions integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  problem text not null,
  evidence_summary text not null,
  proposed_change text not null,
  affected_areas jsonb not null default '[]'::jsonb,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  requires_code_change boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'ai-reviewed', 'owner-reviewed', 'approved-for-build', 'testing', 'ready-for-merge', 'merged', 'rejected')),
  owner_approved_at timestamptz,
  reviewer_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.business_profiles enable row level security;
alter table public.assessments enable row level security;
alter table public.processes enable row level security;
alter table public.automation_opportunities enable row level security;
alter table public.capabilities enable row level security;
alter table public.playbooks enable row level security;
alter table public.playbook_runs enable row level security;
alter table public.improvement_proposals enable row level security;

create policy "members can view their organizations" on public.organizations for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = organizations.id and m.user_id = (select auth.uid())));
create policy "users can view their own memberships" on public.organization_members for select to authenticated using ((select auth.uid()) = user_id);
create policy "members can view business profile" on public.business_profiles for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = business_profiles.organization_id and m.user_id = (select auth.uid())));
create policy "members can view assessments" on public.assessments for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = assessments.organization_id and m.user_id = (select auth.uid())));
create policy "members can view processes" on public.processes for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = processes.organization_id and m.user_id = (select auth.uid())));
create policy "members can view automation opportunities" on public.automation_opportunities for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = automation_opportunities.organization_id and m.user_id = (select auth.uid())));
create policy "authenticated users can view approved capabilities" on public.capabilities for select to authenticated using (status = 'approved');
create policy "authenticated users can view published playbooks" on public.playbooks for select to authenticated using (status = 'published');
create policy "members can view their playbook runs" on public.playbook_runs for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = playbook_runs.organization_id and m.user_id = (select auth.uid())));

-- Insert/update policies are intentionally deferred until auth onboarding and
-- server-side platform administration are implemented. Deny by default is safer.
