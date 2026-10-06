
create table if not exists public.agent_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  repo_key text not null,
  objective text not null,
  preset text not null default 'balanced',
  status text not null default 'planned',
  max_parallel_nodes integer not null default 3,
  max_spend_microusd bigint not null default 0,
  estimated_spend_microusd bigint not null default 0,
  actual_spend_microusd bigint not null default 0,
  competitive_mode boolean not null default false,
  plan jsonb not null default '{}'::jsonb,
  result jsonb null,
  error text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_workflows_repo_check
    check (repo_key in ('cooperative','creatorhub')),
  constraint agent_workflows_preset_check
    check (preset in ('economy','balanced','premium')),
  constraint agent_workflows_status_check
    check (status in ('planned','running','waiting','needs_approval','completed','failed','cancelled')),
  constraint agent_workflows_parallel_check
    check (max_parallel_nodes between 1 and 8),
  constraint agent_workflows_spend_check
    check (
      max_spend_microusd between 0 and 100000000
      and estimated_spend_microusd >= 0
      and actual_spend_microusd >= 0
      and estimated_spend_microusd <= max_spend_microusd
    ),
  constraint agent_workflows_objective_check
    check (char_length(objective) between 1 and 12000)
);

create table if not exists public.agent_workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.agent_workflows(id) on delete cascade,
  node_key text not null,
  role text not null,
  node_kind text not null,
  task_type text not null,
  objective text not null,
  depends_on text[] not null default '{}',
  required boolean not null default true,
  mutates_repo boolean not null default false,
  status text not null default 'blocked',
  selected_provider text null,
  selected_model text null,
  selected_route_kind text null,
  score_snapshot jsonb not null default '{}'::jsonb,
  estimated_cost_microusd bigint not null default 0,
  actual_cost_microusd bigint not null default 0,
  child_agent_task_id uuid null references public.agent_tasks(id) on delete set null,
  child_text_job_id uuid null references public.text_inference_jobs(id) on delete set null,
  child_media_job_id uuid null references public.media_generation_jobs(id) on delete set null,
  result jsonb null,
  error text null,
  attempt integer not null default 0,
  queued_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_workflow_nodes_identity_unique unique (workflow_id,node_key),
  constraint agent_workflow_nodes_key_check
    check (node_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint agent_workflow_nodes_role_check
    check (role ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint agent_workflow_nodes_kind_check
    check (node_kind in ('inference','agent-task','media')),
  constraint agent_workflow_nodes_task_type_check
    check (task_type ~ '^[a-z][a-z0-9-]{0,63}$'),
  constraint agent_workflow_nodes_status_check
    check (status in ('blocked','ready','queued','running','completed','needs_approval','failed','cancelled','skipped')),
  constraint agent_workflow_nodes_cost_check
    check (estimated_cost_microusd >= 0 and actual_cost_microusd >= 0),
  constraint agent_workflow_nodes_attempt_check
    check (attempt between 0 and 20),
  constraint agent_workflow_nodes_objective_check
    check (char_length(objective) between 1 and 12000)
);

create table if not exists public.agent_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.agent_workflows(id) on delete cascade,
  node_id uuid null references public.agent_workflow_nodes(id) on delete cascade,
  owner_ref text not null,
  kind text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_workflow_events_kind_check
    check (kind ~ '^[a-z][a-z0-9-]{0,63}$')
);

create index if not exists agent_workflows_owner_status_idx
  on public.agent_workflows(owner_ref,status,created_at desc);

create index if not exists agent_workflow_nodes_workflow_status_idx
  on public.agent_workflow_nodes(workflow_id,status,created_at);

create index if not exists agent_workflow_nodes_agent_task_idx
  on public.agent_workflow_nodes(child_agent_task_id)
  where child_agent_task_id is not null;

create index if not exists agent_workflow_nodes_text_job_idx
  on public.agent_workflow_nodes(child_text_job_id)
  where child_text_job_id is not null;

create index if not exists agent_workflow_events_workflow_idx
  on public.agent_workflow_events(workflow_id,created_at);

create unique index if not exists agent_workflow_one_active_repo_mutation
  on public.agent_workflow_nodes(workflow_id)
  where mutates_repo = true and status in ('queued','running');

alter table public.agent_workflows enable row level security;
alter table public.agent_workflow_nodes enable row level security;
alter table public.agent_workflow_events enable row level security;

comment on table public.agent_workflows is
  'Bounded multi-agent request graph with one shared concurrency and spend ceiling.';
comment on table public.agent_workflow_nodes is
  'Dependency-aware workflow nodes. Independent nodes may execute concurrently; repo-mutating nodes are serialized.';
comment on table public.agent_workflow_events is
  'Append-only execution and routing events for multi-agent workflows.';
