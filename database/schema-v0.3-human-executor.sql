-- CoOperative Human Executor v0.3 — REVIEW ONLY
-- ---------------------------------------------------------------------------
-- DO NOT APPLY until the owner explicitly approves the workforce database/RLS gate.
-- The first UI slice uses local demo state + test earnings only.
--
-- Security model:
-- - organizations fund/own work orders;
-- - workers own only their worker profile and their own submissions;
-- - offers, assignment acceptance, verification, and earnings mutation are
--   server-mediated to prevent races, forged pay, and cross-worker access;
-- - a worker can read task detail only after receiving an offer/assignment;
-- - service_role is server-only and must never be exposed to a browser.

create table if not exists public.worker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  skills text[] not null default '{}',
  devices text[] not null default '{}',
  location_mode text not null default 'remote'
    check (location_mode in ('remote', 'local', 'either')),
  minimum_hourly_rate_cents integer not null default 0
    check (minimum_hourly_rate_cents between 0 and 100000),
  preferred_task_minutes integer not null default 30
    check (preferred_task_minutes between 1 and 480),
  blocked_categories text[] not null default '{}',
  notifications_enabled boolean not null default true,
  payout_status text not null default 'not_connected'
    check (payout_status in ('not_connected', 'pending', 'ready', 'restricted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.human_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operative_task_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  summary text not null check (char_length(summary) between 1 and 2000),
  status text not null default 'draft'
    check (status in ('draft', 'offered', 'assigned', 'in_progress', 'verifying', 'completed', 'cancelled')),
  compensation_cents integer not null check (compensation_cents > 0),
  estimated_minutes integer not null check (estimated_minutes between 1 and 480),
  location_mode text not null default 'remote'
    check (location_mode in ('remote', 'local', 'either')),
  requirements jsonb not null default '{}'::jsonb,
  deadline_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint human_work_orders_task_org_fk
    foreign key (operative_task_id, organization_id)
    references public.operative_tasks(id, organization_id)
);

create table if not exists public.human_work_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.human_work_orders(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  title text not null check (char_length(title) between 1 and 120),
  instruction text not null check (char_length(instruction) between 1 and 2000),
  input_kind text not null
    check (input_kind in ('open_link', 'yes_no', 'confirm', 'text', 'photo')),
  external_url text,
  help_text text not null default '',
  required boolean not null default true,
  constraint human_work_steps_order_sequence_unique unique (work_order_id, sequence)
);

create table if not exists public.human_work_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.human_work_orders(id) on delete cascade,
  worker_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  offered_compensation_cents integer not null check (offered_compensation_cents > 0),
  offered_at timestamptz not null default now(),
  expires_at timestamptz,
  responded_at timestamptz,
  constraint human_work_offers_worker_order_unique unique (work_order_id, worker_user_id)
);

create table if not exists public.human_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.human_work_orders(id) on delete cascade,
  worker_user_id uuid not null references auth.users(id) on delete cascade,
  compensation_cents integer not null check (compensation_cents > 0),
  status text not null default 'accepted'
    check (status in ('accepted', 'in_progress', 'submitted', 'verified', 'rejected', 'cancelled')),
  accepted_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_at timestamptz,
  constraint human_assignments_one_worker_per_order unique (work_order_id)
);

create table if not exists public.human_step_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignment_id uuid not null references public.human_assignments(id) on delete cascade,
  step_id uuid not null references public.human_work_steps(id) on delete cascade,
  worker_user_id uuid not null references auth.users(id) on delete cascade,
  answer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint human_step_submissions_assignment_step_unique unique (assignment_id, step_id)
);

create table if not exists public.worker_earnings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignment_id uuid not null unique references public.human_assignments(id) on delete cascade,
  worker_user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'pending'
    check (status in ('test', 'pending', 'available', 'paid', 'void')),
  payout_provider text,
  payout_reference text,
  created_at timestamptz not null default now(),
  available_at timestamptz,
  paid_at timestamptz
);

create index if not exists human_work_orders_org_status_idx
  on public.human_work_orders(organization_id, status);
create index if not exists human_work_offers_worker_status_idx
  on public.human_work_offers(worker_user_id, status);
create index if not exists human_assignments_worker_status_idx
  on public.human_assignments(worker_user_id, status);
create index if not exists worker_earnings_worker_status_idx
  on public.worker_earnings(worker_user_id, status);

alter table public.worker_profiles enable row level security;
alter table public.human_work_orders enable row level security;
alter table public.human_work_steps enable row level security;
alter table public.human_work_offers enable row level security;
alter table public.human_assignments enable row level security;
alter table public.human_step_submissions enable row level security;
alter table public.worker_earnings enable row level security;

revoke all on public.worker_profiles from anon;
revoke all on public.human_work_orders from anon;
revoke all on public.human_work_steps from anon;
revoke all on public.human_work_offers from anon;
revoke all on public.human_assignments from anon;
revoke all on public.human_step_submissions from anon;
revoke all on public.worker_earnings from anon;

grant select, insert, update on public.worker_profiles to authenticated;
grant select on public.human_work_orders to authenticated;
grant select on public.human_work_steps to authenticated;
grant select on public.human_work_offers to authenticated;
grant select on public.human_assignments to authenticated;
grant select, insert, update on public.human_step_submissions to authenticated;
grant select on public.worker_earnings to authenticated;

grant all on public.worker_profiles to service_role;
grant all on public.human_work_orders to service_role;
grant all on public.human_work_steps to service_role;
grant all on public.human_work_offers to service_role;
grant all on public.human_assignments to service_role;
grant all on public.human_step_submissions to service_role;
grant all on public.worker_earnings to service_role;

create policy "workers_manage_own_profile"
on public.worker_profiles
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "owners_read_work_orders"
on public.human_work_orders for select
to authenticated
using (exists (
  select 1 from public.organizations o
  where o.id = organization_id and o.owner_user_id = (select auth.uid())
));

create policy "workers_read_offered_or_assigned_work_orders"
on public.human_work_orders for select
to authenticated
using (
  exists (
    select 1 from public.human_work_offers offer
    where offer.work_order_id = human_work_orders.id
      and offer.worker_user_id = (select auth.uid())
      and offer.status in ('offered', 'accepted')
  )
  or exists (
    select 1 from public.human_assignments assignment
    where assignment.work_order_id = human_work_orders.id
      and assignment.worker_user_id = (select auth.uid())
  )
);

create policy "workers_read_visible_work_steps"
on public.human_work_steps for select
to authenticated
using (
  exists (
    select 1 from public.human_work_offers offer
    where offer.work_order_id = human_work_steps.work_order_id
      and offer.worker_user_id = (select auth.uid())
      and offer.status = 'accepted'
  )
  or exists (
    select 1 from public.human_assignments assignment
    where assignment.work_order_id = human_work_steps.work_order_id
      and assignment.worker_user_id = (select auth.uid())
  )
);

create policy "workers_read_own_offers"
on public.human_work_offers for select
to authenticated
using (worker_user_id = (select auth.uid()));

create policy "workers_read_own_assignments"
on public.human_assignments for select
to authenticated
using (worker_user_id = (select auth.uid()));

create policy "workers_read_own_step_submissions"
on public.human_step_submissions for select
to authenticated
using (worker_user_id = (select auth.uid()));

create policy "workers_insert_own_step_submissions"
on public.human_step_submissions for insert
to authenticated
with check (
  worker_user_id = (select auth.uid())
  and exists (
    select 1 from public.human_assignments assignment
    where assignment.id = assignment_id
      and assignment.worker_user_id = (select auth.uid())
      and assignment.status in ('accepted', 'in_progress')
  )
);

create policy "workers_update_own_step_submissions"
on public.human_step_submissions for update
to authenticated
using (worker_user_id = (select auth.uid()))
with check (
  worker_user_id = (select auth.uid())
  and exists (
    select 1 from public.human_assignments assignment
    where assignment.id = assignment_id
      and assignment.worker_user_id = (select auth.uid())
      and assignment.status in ('accepted', 'in_progress')
  )
);

create policy "workers_read_own_earnings"
on public.worker_earnings for select
to authenticated
using (worker_user_id = (select auth.uid()));

-- Intentionally omitted:
-- - worker-side INSERT/UPDATE on offers/assignments/earnings;
-- - public work-order discovery;
-- - payout provider mutation;
-- - widening operative_tasks.selected_executor to human-executor.
--
-- Those operations must be mediated by reviewed server routes. The existing
-- operative executor enum/database check should only be widened in the same
-- approved migration that turns Human Executor dispatch on.
