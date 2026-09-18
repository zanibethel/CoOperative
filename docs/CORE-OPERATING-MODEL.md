# CoOperative Core Operating Model

This document defines the architectural mindset that should survive individual providers, AI models, integrations, pricing changes, and implementation details.

## North-star product

CoOperative should become a conversational business operating system.

A business owner should be able to talk to CoOperative naturally, connect the services they already use, and let CoOperative build and operate the lowest-cost reliable system that supports the business.

The owner should not need to understand APIs, OAuth, webhooks, AI models, hosting, databases, workflow engines, or provider-specific implementation details.

CoOperative owns the experience. Providers are replaceable infrastructure underneath it.

## Business economic mandate

CoOperative exists to improve the economic health of the customer's business.

Every meaningful recommendation, automation, integration, and improvement should support one or more of these outcomes:

1. **Protect revenue** — reduce missed leads, failed follow-up, churn, no-shows, payment leakage, downtime, and other preventable loss.
2. **Save money** — remove unnecessary subscriptions, reduce manual labor, lower infrastructure cost, replace expensive providers where safe, and eliminate waste.
3. **Make more money** — improve conversion, retention, repeat purchases, utilization, average order value, marketing performance, and customer acquisition.
4. **Create new revenue** — identify and help launch viable new products, services, packages, channels, partnerships, affiliate opportunities, digital offerings, or AI-enabled services.

CoOperative should not stop at maintaining existing processes. It should continuously search for economically useful opportunities the business is not yet using.

The system should be able to say, for example:

> You have unused appointment capacity next week. I can prepare a reactivation campaign using customers who have not booked in 90 days.

or:

> Customers repeatedly ask for this adjacent service. I can model the economics, build the landing page, add booking/payment support, and prepare a limited launch for your approval.

or:

> This product/service has an affiliate or referral opportunity that fits your existing customer journey. Here is the expected value, cost, disclosure requirement, and implementation plan.

Growth recommendations must be measurable. Prefer expected contribution margin, payback, conversion, retention, or other business outcomes over vanity metrics.

Platform financial incentives must never silently override the customer's economic interest. If CoOperative or its operator receives an affiliate/referral benefit from a recommendation, that relationship should be disclosed and the system should still compare credible alternatives.

## Core principle

> If CoOperative already knows how to do something, it should execute that knowledge from code, rules, scripts, and playbooks instead of paying an AI to figure it out again.

AI is a replaceable reasoning capability inside CoOperative. AI is not the source of truth for how CoOperative operates.

The durable intellectual property of CoOperative is:

- versioned playbooks;
- deterministic scripts/functions;
- capability contracts;
- connector contracts;
- business policies and approval rules;
- cost controls;
- growth/revenue playbooks;
- outcome/evidence history;
- reusable schemas and tests.

## Execution priority

For every task, CoOperative should prefer this order:

1. deterministic code or an existing script;
2. an approved published playbook;
3. an approved native CoOperative capability;
4. an approved connected external capability;
5. a low-cost AI call for a narrowly defined reasoning/generation step;
6. a stronger AI model only when cheaper options cannot meet the required quality;
7. human review/decision when policy, uncertainty, or risk requires it.

Do not call an LLM to rediscover information or logic already encoded in the platform.

## Playbook-first architecture

A playbook is the best known reusable process for solving a business problem or capturing a business opportunity.

A mature playbook may define:

- trigger;
- required inputs;
- prerequisites;
- deterministic steps;
- scripts/functions;
- required capabilities;
- optional AI steps;
- required AI capability rather than a hard-coded model;
- required output schema;
- provider-independent service actions;
- approval requirements;
- cost ceiling;
- expected economic outcome;
- fallback behavior;
- tests;
- metrics;
- failure conditions;
- evidence;
- version.

Example:

```text
Customer Re-engagement v4
  -> query customers inactive for 60+ days        [script]
  -> remove opted-out customers                   [script]
  -> remove unresolved complaint cases            [script]
  -> choose approved campaign strategy             [rule]
  -> draft personalized message                    [AI capability]
  -> validate business/policy constraints          [script]
  -> request approval when required                [policy]
  -> send through available channel                [capability router]
  -> measure replies/bookings                      [script]
  -> record cost + outcome                         [evidence]
```

The AI should not reinvent those steps.

## Growth Opportunity Engine

CoOperative should continuously evaluate whether there is a better economic action available than simply continuing the current process.

Opportunity sources may include:

- unfilled capacity;
- stale leads;
- dormant customers;
- abandoned carts/quotes;
- high-demand services;
- frequently requested adjacent services;
- repeat-purchase timing;
- cross-sell and upsell patterns;
- new geographic/channel opportunities;
- ad campaign opportunities;
- referral programs;
- affiliate programs;
- digital products;
- subscriptions/memberships;
- new AI-enabled services the business can offer;
- new native CoOperative capabilities that unlock revenue.

A growth opportunity should become a structured proposal containing, where possible:

- opportunity type;
- evidence;
- target customer segment;
- expected revenue or savings;
- expected variable cost;
- expected contribution margin;
- implementation cost;
- risk;
- required capabilities;
- required customer approvals;
- measurement plan;
- stop/rollback condition.

The preferred loop is:

```text
observe opportunity
  -> estimate economics
  -> find existing playbook
  -> build/adapt only what is missing
  -> customer approval when required
  -> limited launch/test
  -> measure
  -> expand, revise, or stop
  -> promote proven pattern into a better playbook
```

CoOperative should prefer small measurable experiments before committing a business to large advertising spend or a major operational change.

## Small execution context

When AI is required, CoOperative should provide only the context needed for the current step:

- relevant business facts;
- current playbook step;
- applicable business/customer policy;
- approved capabilities;
- required output schema.

Do not repeatedly send the whole company history, platform architecture, or full playbook library to a model.

This reduces token usage, latency, cost, and hallucination surface.

## Interchangeable AI

Playbooks must never depend on a specific AI provider unless a provider-specific feature is explicitly required.

A playbook requests an AI capability, for example:

```text
capability: structured_business_reasoning
quality_floor: 0.92
maximum_cost: 0.03 USD
output_schema: BusinessRecommendation
```

The AI Router selects the cheapest approved option that satisfies the requirement.

Possible providers may include commercial models, open-weight hosted models, self-hosted models, or future CoOperative models.

The rest of the workflow must remain unchanged when the AI provider changes.

## Interchangeable business services

Playbooks should also avoid hard-coding external providers.

Prefer:

```text
communication.sendSMS()
calendar.createBooking()
payments.createDeposit()
crm.upsertCustomer()
```

over:

```text
twilio.send()
square.booking.create()
provider_x.customer.update()
```

The Capability Router selects the approved implementation based on:

- customer authorization;
- available capabilities;
- reliability;
- cost;
- risk;
- business policy;
- plan budget.

This allows CoOperative to replace providers without changing the customer's workflow.

## Connected-service migration strategy

CoOperative should meet the customer where they are.

For every current paid service:

```text
Connect
  -> Observe
  -> Understand
  -> Compare
  -> Optimize
  -> Mirror
  -> Shadow-test
  -> Offer replacement
  -> Migrate
  -> Measure
```

Do not force a customer to replace a working service before CoOperative can demonstrate a safer or cheaper alternative.

Connected Services should track:

- provider;
- current cost;
- features actually used;
- available data;
- permissions;
- connection method;
- replacement goal;
- native coverage;
- replacement readiness;
- estimated savings;
- measured outcome after migration.

## Connector Factory

Hermes and approved development agents should eventually be able to turn newly discovered providers into governed connectors.

Connector lifecycle:

```text
provider discovered
  -> research official integration options
  -> identify OAuth/API/webhook/import paths
  -> define scopes + risks
  -> create provider manifest
  -> build adapter
  -> build authorization/callback flow
  -> implement token refresh/credential references
  -> implement supported actions
  -> add tests
  -> run sandbox/preview verification
  -> security review
  -> owner approval
  -> publish connector
```

Customer passwords should not be stored or used as the primary connection method. Prefer OAuth/OIDC and official APIs. Credential material belongs in secure secret infrastructure; tenant tables store only references/metadata.

## Cost Governor

CoOperative must protect unit economics by design.

Each customer account has:

- plan revenue;
- target gross margin;
- maximum allowable service cost;
- projected monthly infrastructure cost;
- actual usage cost;
- remaining budget;
- escalation policy.

Default principle:

> Customer revenue must cover the cost to serve the customer, and CoOperative should preserve at least a 50% gross margin unless an explicitly approved pricing strategy says otherwise.

Formula:

```text
maximum_service_cost = plan_price * (1 - target_margin)
required_plan_price  = projected_service_cost / (1 - target_margin)
```

Example:

```text
plan_price = $50
target_margin = 60%
maximum_service_cost = $20
```

If projected cost exceeds the account's budget, CoOperative should:

1. optimize routing/provider choices;
2. reduce unnecessary AI calls;
3. use deterministic execution where possible;
4. batch/cache/reuse results where safe;
5. reduce optional output/usage when appropriate;
6. ask the customer to approve a higher package when required capabilities cannot fit the current plan.

Never silently operate an account at a structurally losing cost.

The customer's own growth initiatives should also be evaluated economically. A campaign that creates revenue but destroys contribution margin is not automatically a good recommendation.

## AI cost strategy

Use the cheapest approved intelligence that meets the quality floor.

Typical routing pattern:

```text
deterministic code
  -> small/cheap model
  -> mid-tier model
  -> strong reasoning model
  -> second-model verification and/or human approval for high-risk cases
```

Premium AI should be escalation infrastructure, not the default for every operation.

## Hermes role

Hermes is the Platform Operative / Improvement Engineer.

Hermes should spend its budget primarily on leverage that improves the platform for many customers:

- provider discovery;
- API/OAuth research;
- connector creation;
- connector maintenance;
- playbook improvement;
- growth-playbook discovery and validation;
- identifying new revenue-capability patterns;
- removing unnecessary AI steps;
- replacing AI reasoning with deterministic code when possible;
- discovering cheaper models/providers;
- benchmarking replacements;
- preparing isolated code changes;
- running tests/evals;
- measuring projected savings and economic upside.

Hermes should not be the expensive default engine for routine customer tasks when a cheaper model, playbook, or script can do the work.

## Governed Hermes autonomy

Hermes may gradually earn permission for specific low-risk update classes.

Target progression:

```text
research/propose
  -> prepare branch + tests
  -> create PR
  -> auto-test in preview
  -> auto-merge approved low-risk categories
  -> auto-deploy approved low-risk categories
```

High-risk areas stay human-gated much longer, including:

- authentication and RLS;
- billing and money movement;
- secrets;
- production permissions;
- customer-data access;
- destructive operations;
- database migrations;
- changes that broaden agent authority.

## Improvement loop

CoOperative should improve its institutional knowledge, not merely create longer prompts.

```text
observe outcome
  -> identify better method or economic opportunity
  -> modify/create playbook or script
  -> test/evaluate
  -> compare cost + quality + business outcome
  -> approve
  -> publish new version
  -> monitor
  -> preserve evidence
```

A valuable improvement often means removing an AI call entirely.

Example:

```text
Appointment Recovery v7 -> v8
AI calls/run: 3 -> 1
Average cost: $0.041 -> $0.012
Quality floor: maintained
Tests: passed
```

A valuable improvement can also create new revenue while remaining repeatable and measurable.

## Long-term CoOperative model strategy

Do not begin by training a general-purpose foundation model from scratch.

First build proprietary operational assets:

- structured business profiles;
- accepted/rejected recommendations;
- versioned playbooks;
- revenue/growth playbooks;
- execution outcomes;
- cost/performance measurements;
- economic outcome measurements;
- evaluation sets;
- connector knowledge;
- policy decisions.

Then progressively reduce external AI dependence:

```text
commercial models
  -> cheaper commercial models
  -> open-weight hosted models
  -> specialized/fine-tuned models
  -> self-hosted inference
  -> CoOperative-specific operational models
```

The goal is not necessarily to recreate a frontier general-purpose LLM.

A smaller CoOperative model that is exceptionally good at selecting playbooks, capabilities, and profitable business actions may provide much better economics.

## Customer experience rule

The infrastructure can be complicated. The customer experience should not be.

The owner should be able to say:

> I need more appointments next week.

CoOperative should determine the appropriate approved playbook, business data, channels, budget, connectors, and AI capability underneath that request.

CoOperative should also be able to proactively say:

> I found a credible way to increase next month's revenue. Here is why, what it should cost, what I expect it to return, and what I need you to approve.

The customer should care about the business result, not which API or model performed it.

## Architecture summary

```text
Business Owner / CoOperative Conversation
                |
                v
 Business State + Policies + Economic Goals
                |
                +----------------------+
                |                      |
                v                      v
        Playbook Engine       Growth Opportunity Engine
                |                      |
       +--------+--------+             |
       |                 |             |
       v                 v             |
Script / Function    Reasoning Required?
Library                  |
                         v
                     AI Router
                         |
                 cheapest qualified AI
       |                 |
       +--------+--------+
                |
                v
         Capability Router
                |
     +----------+----------+
     |                     |
native CoOperative     connected provider
capability             / API / connector
     |                     |
     +----------+----------+
                |
                v
          Execution Engine
                |
                v
      Outcome + Revenue + Cost Ledger
                |
                v
       Evidence / Improvement Lab
                |
                v
              Hermes
                |
                v
 reviewed playbook / connector / growth / code improvements
```

## Non-negotiable architectural tests

Before adding a feature, ask:

1. Can deterministic code do this before AI is called?
2. Is there already a playbook for this problem or opportunity?
3. Are we duplicating knowledge inside a prompt instead of storing it in CoOperative?
4. Is the AI provider replaceable?
5. Is the external provider replaceable?
6. Are permissions least-privilege?
7. Does the customer understand/approve high-impact actions?
8. Is customer data tenant-isolated?
9. Does this fit the customer's cost envelope?
10. Does it protect revenue, save money, make more money, or create a credible new revenue path?
11. Is the expected business outcome measurable?
12. Will the outcome create useful evidence for the next version?

If the implementation fails these tests without a strong reason, redesign it.
