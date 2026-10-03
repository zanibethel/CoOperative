alter table public.personal_ai_settings
  add column if not exists media_content_preference text not null default 'sfw_only',
  add column if not exists adult_content_acknowledged_at timestamptz;

alter table public.personal_ai_settings
  drop constraint if exists personal_ai_settings_media_content_preference_check;

alter table public.personal_ai_settings
  add constraint personal_ai_settings_media_content_preference_check
  check (
    media_content_preference in (
      'sfw_only',
      'adult_allowed',
      'prefer_adult_capable',
      'require_adult_capable'
    )
  );

create table if not exists public.media_model_capabilities (
  provider text not null,
  model text not null,
  endpoint text not null default '',
  adult_content_policy text not null default 'unknown'
    check (adult_content_policy in ('unknown', 'disallowed', 'allowed')),
  adult_content_policy_source text,
  adult_content_policy_checked_at timestamptz,
  reference_capability text not null default 'unknown',
  reference_capability_source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, model, endpoint)
);

create table if not exists public.media_model_capability_tests (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  provider text not null,
  model text not null,
  endpoint text not null default '',
  test_type text not null
    check (
      test_type in (
        'adult_content',
        'reference_fidelity',
        'identity_preservation',
        'edit_strength',
        'policy_behavior',
        'other'
      )
    ),
  outcome text not null
    check (
      outcome in (
        'supported',
        'blocked',
        'partial',
        'inconclusive'
      )
    ),
  source_job_id uuid references public.media_generation_jobs(id) on delete set null,
  prompt_classification text,
  notes text,
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists media_model_capability_tests_lookup_idx
  on public.media_model_capability_tests (owner_ref, provider, model, endpoint, test_type, tested_at desc);

alter table public.media_model_capabilities enable row level security;
alter table public.media_model_capability_tests enable row level security;

insert into public.media_model_capabilities (
  provider,
  model,
  endpoint,
  adult_content_policy,
  reference_capability,
  reference_capability_source,
  notes
)
values
  (
    'nous',
    'openai/gpt-image-2.5/sunburst/text-to-image',
    'openai/gpt-image-2.5/sunburst/edit',
    'unknown',
    'precision-edit',
    'Hermes v2026.9.24 catalog',
    'Reference route verified on this CoOperative profile; adult capability remains untested.'
  ),
  (
    'nous',
    'openai/gpt-image-2.5/flare/text-to-image',
    'openai/gpt-image-2.5/flare/edit',
    'unknown',
    'identity-reference',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  ),
  (
    'nous',
    'fal-ai/flux-2-pro',
    'fal-ai/flux-2-pro/edit',
    'unknown',
    'multi-reference-edit',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  ),
  (
    'nous',
    'fal-ai/nano-banana-pro',
    'fal-ai/nano-banana-pro/edit',
    'unknown',
    'semantic-multi-reference',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  ),
  (
    'nous',
    'fal-ai/nano-banana-2',
    'fal-ai/nano-banana-2/edit',
    'unknown',
    'semantic-multi-reference',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  ),
  (
    'nous',
    'fal-ai/qwen-image',
    'fal-ai/qwen-image-2/pro/edit',
    'unknown',
    'multi-reference-edit',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  ),
  (
    'nous',
    'fal-ai/flux-2/klein/9b',
    'fal-ai/flux-2/klein/9b/edit',
    'unknown',
    'fast-reference-edit',
    'Hermes v2026.9.24 catalog',
    'Adult capability remains untested.'
  )
on conflict (provider, model, endpoint) do nothing;
