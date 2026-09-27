# CoOperative Agent-Runtime Strategy

Status: architecture direction  
Reviewed: 2026-09-27

## Why this exists

General-purpose computer agents are becoming commodity execution infrastructure.

Perplexity Computer now provides many capabilities that overlap with the original
CoOperative bootstrap vision: natural-language task intake, subagents, browser
automation, connected services, long-running work, reusable skills, persistent
project context, coding/deployment, credential-backed API access, local/hybrid
computer use, and usage controls.

CoOperative should not spend its engineering budget recreating those generic
agent primitives merely to own them.

The product advantage is the layer above them:

- know the business and its economics;
- know what tools/services it already pays for;
- choose the cheapest qualified execution path;
- prefer deterministic code and proven playbooks over fresh reasoning;
- enforce permissions, cost ceilings, approvals, and rollback;
- measure whether the work saved or made money;
- turn successful work into cheaper reusable automation;
- route irreducibly human work to compensated people.

**CoOperative is the governor/orchestrator and system of record. Agent products
are replaceable workers underneath it.**

## Current market reference: Perplexity Computer

Public Perplexity material reviewed for this architecture:

- Computer product overview:
  https://www.perplexity.ai/products/computer
- Projects / persistent files, memory, and project-scoped connectors:
  https://www.perplexity.ai/changelog/shared-workspaces-personal-computer-for-windows-and-model-council
- Custom API credential vault:
  https://www.perplexity.ai/changelog/role-based-access-controls-api-credentials-and-brain-for-max
- Brain / reusable cross-task memory:
  https://www.perplexity.ai/changelog/brain-faster-computer-models-website-publishing
- Effort Mode, Skills Marketplace, local/hybrid compute:
  https://www.perplexity.ai/changelog/effort-mode-gpt-6-astra-and-skills-marketplace
- Custom credit limits:
  https://www.perplexity.ai/changelog/deep-research-command-panel-forking-inline-actions-and-enterprise-controls
- API platform / Agent API announcement:
  https://www.perplexity.ai/changelog/what-we-shipped---march-13-2026

These capabilities and commercial terms are time-sensitive registry data, not
permanent assumptions.

## KEEP / INTEGRATE / REPLACE / BUILD

| Area | Direction | CoOperative decision |
| --- | --- | --- |
| Natural-language owner experience | KEEP | CoOperative remains the primary business operating surface. |
| Canonical task state, decisions, audit, evidence | KEEP | Provider threads are not the system of record. |
| Deterministic scripts/functions | KEEP | Highest-priority execution path when qualified. |
| Versioned playbooks | KEEP | Reuse successful processes instead of reprompting an agent. |
| Cost Governor | KEEP + EXPAND | Route on marginal cost, plan margin, hard caps, and measured quality. |
| Business economics / growth engine | KEEP | Optimize business outcomes, not agent activity. |
| Provider bootstrap / connector factory | KEEP | Minimize owner setup and preserve provider independence. |
| Human Executor | KEEP + BUILD | Distinctive fallback for judgment, physical-world, device, empathy, and legally/operationally human work. |
| Generic browser agent | INTEGRATE | Prefer approved external runtimes when cheaper/better than maintaining our own. |
| Generic research agent | INTEGRATE | Route to the cheapest qualified provider; retain evidence in CoOperative. |
| Generic coding agent | INTEGRATE | ChatGPT, Hermes, Perplexity-like runtimes, or future providers can compete for the task. |
| Long-running autonomous agent loop | INTEGRATE | Treat as an executor capability, not a Hermes-only feature. |
| Generic agent memory | REPLACE AS AUTHORITY | External memory may help execution, but canonical durable memory remains CoOperative-owned. |
| Generic skills marketplace | INTEGRATE + TRANSLATE | External skills can be executor capabilities; proven business processes become CoOperative playbooks. |
| Model council / multi-model orchestration | INTEGRATE | Buy it when economical instead of recreating it by default. |
| Local/hybrid computer control | INTEGRATE | Use an approved runtime when local access is required; do not make a Mac a permanent dependency. |
| Provider-specific cost controls | INTEGRATE | Useful defense layer, but CoOperative's own budget/margin policy remains authoritative. |
| Outcome verification | BUILD | Independently verify whether delegated work met the playbook contract. |
| Executor marketplace/router | BUILD | Compare deterministic, flat-rate connected, native, external agent, Hermes, and human paths. |
| Outcome-to-playbook learning | BUILD | Repeated successful agent work should migrate toward cheaper deterministic automation. |

## New execution model

    Owner / business event
            |
            v
    CoOperative canonical task
            |
            v
    Policy + approval + economic constraints
            |
            v
    Known playbook?
       | yes                    | no
       v                        v
    deterministic steps     small planning/reasoning step
       |                        |
       +-----------+------------+
                   |
                   v
          Required capability set
                   |
                   v
            Executor marketplace
                   |
       +-----------+-----------+-----------+-----------+-----------+
       |           |           |           |           |           |
    script     owner-paid    native     external     Hermes      human
    /code      assistant     capability agent        runtime      executor
       |           |           |           |           |           |
       +-----------+-----------+-----------+-----------+-----------+
                   |
                   v
           cheapest qualified path
      satisfying cost + risk + quality
                   |
                   v
            execute + verify outcome
                   |
                   v
     cost / evidence / business result
                   |
                   v
      reuse -> improve -> remove AI where possible

## Executor capabilities, not provider names

Tasks should specify what they need, for example:

    required capabilities:
    - browser-automation
    - research
    - autonomous-execution
    - persistent-workspace

    minimum quality: 0.90
    maximum marginal cost: $0.04
    risk: medium
    owner approval: required before production write

Candidates then advertise what they can actually provide:

    deterministic-code
    connected-chatgpt
    native-capability
    external-ai-provider / providerKey=perplexity-computer
    hermes-cloud-operative
    future human-executor

The current database enum is deliberately unchanged by this architecture slice.
External agent runtimes continue to fit under external-ai-provider with a
provider key until a reviewed migration changes the canonical executor schema.
The Human Executor database activation remains a separate explicit owner gate.

## Cost-saving rules that differentiate CoOperative

### 1. Never pay twice for known work

If a reviewed script/playbook can perform the step, do not ask a general-purpose
agent to rediscover it.

### 2. Flat-rate capacity participates in routing

If the owner/customer already pays for a connected tool or assistant and the
incremental cost is effectively zero, that should be considered before paid
usage-based agent calls when it is qualified and allowed.

Allocated subscription cost still belongs in unit-economics reporting. Zero
marginal cost must never be misreported as free infrastructure.

### 3. Split tasks before escalating

A paid agent task may contain deterministic filtering, lightweight
classification, browser research, an owner approval, and deterministic
verification. Route individual steps instead of sending the whole mission to
the most expensive executor.

### 4. Hard caps fail closed

Unknown cost is not zero. If an executor cannot support a safe cost estimate for
a capped task, CoOperative should block/escalate rather than silently exceed the
envelope.

### 5. Quality floors beat cheap failure

The cheapest executor only wins if it satisfies the task's measured quality and
capability requirements.

### 6. Successful agent work should get cheaper over time

    agent-assisted run
      -> capture steps and evidence
      -> identify deterministic portions
      -> create/update playbook
      -> add tests
      -> route future runs through cheaper automation
      -> keep the agent for exceptions

### 7. Human work is intentionally scarce and well-prepared

Humans should receive only the smallest meaningful human-needed slice, with
clear compensation, estimated time, guided phone steps, and no proposal/bidding
friction.

## Good delegation candidates

- broad current research;
- unfamiliar websites;
- multi-site browser workflows;
- one-off code/build work;
- parallel subagent exploration;
- long-running monitoring where the runtime price is competitive;
- temporary access to a large connector catalog;
- local/hybrid-computer tasks when policy permits.

## Poor delegation candidates

- work already encoded in a playbook;
- database transformations with stable deterministic rules;
- repetitive known API operations;
- tasks where external agent credit cost exceeds a native/script path;
- high-risk actions before CoOperative approval/policy checks;
- canonical memory/audit ownership;
- human-only work.

## Provider adapter rule

No playbook should say "Use Perplexity."

It should specify capabilities, quality floor, marginal-cost cap, risk, and
approval requirements. The registry/router may then select Perplexity, Hermes,
ChatGPT tooling, another agent provider, or no provider at all.

## Near-term implementation sequence

1. Make executor routing capability-based instead of Hermes-special-cased.
2. Add external agent-runtime provider profiles to the Capability Registry.
3. Add an adapter contract for delegated agents: submit, status, steer, cancel,
   artifacts, usage/cost, and evidence.
4. Add Perplexity as a research candidate, not an automatic trusted executor.
5. Measure it against Hermes and existing connected tooling on the same bounded
   tasks.
6. Promote only the capabilities where it wins on cost/quality/reliability.
7. Keep developing the Human Executor as the fallback generic computer agents
   do not provide.
8. Add automatic agent-work-to-playbook candidate extraction so repeated work
   becomes progressively cheaper.

## Non-goals

This direction does not mean:

- making CoOperative a thin Perplexity wrapper;
- depending on one external agent provider;
- abandoning Hermes;
- abandoning CoOperative memory;
- moving policy/approvals into an external agent;
- sending every customer task to an AI computer;
- applying the Human Executor schema without owner approval;
- changing production secrets or database constraints in this architecture PR.

The goal is to buy commodity intelligence/execution where useful while keeping
the differentiated economic and governance layer inside CoOperative.
