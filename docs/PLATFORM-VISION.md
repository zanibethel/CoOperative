# CoOperative Platform Vision

## Product promise

A business owner should be able to say:

> Here is how my business works. Help my team and AI work together better.

CoOperative should discover the current operation, connect to the services the business already uses, understand what those services actually provide and cost, recommend the simplest cost-effective solution, deploy approved workflows, measure what happened, reuse what proved successful, and continuously surface credible ways to improve the economics of the business.

The long-term product is a conversational business operating system. The owner should primarily interact with CoOperative, while external providers and AI models remain replaceable infrastructure underneath it.

## Economic mission

CoOperative should continuously work toward four outcomes for the customer:

1. protect existing revenue;
2. save money;
3. increase revenue from the current business;
4. identify and help launch credible new revenue opportunities.

That includes improving current processes, but it also includes proactively identifying opportunities such as reactivation campaigns, advertising experiments, upsells/cross-sells, referral or affiliate programs, new channels, digital products, memberships, and new AI-enabled services the business could offer.

Growth recommendations should include expected economics, required spend/capabilities, approvals, a measurement plan, and a stop condition. Prefer small measurable experiments before large commitments.

If CoOperative or its operator has a financial incentive in a recommended affiliate/referral option, that relationship should be disclosed and credible alternatives should still be considered.

## Architectural doctrine

CoOperative is **playbook-first and code-first**.

If the platform already knows how to do something, it should execute the known script, rule, function, or playbook instead of paying an AI to reason through the same problem again.

AI is used only for steps that genuinely require reasoning, interpretation, or generation. AI providers must remain interchangeable behind stable contracts.

See `docs/CORE-OPERATING-MODEL.md` for the full doctrine.

## Eight product systems

### 1. Intelligence Desk
Builds a structured business model from conversations, connected systems, documents, websites, and observed workflows.

### 2. Connected Services / Cost Map
Tracks what a customer already uses, what it costs, which features matter, what data is available, and whether each service should be kept, optimized, mirrored, or replaced.

### 3. Capability Registry
A current catalog of what CoOperative can use: native modules, APIs, plugins/connectors, workflow engines, AI capabilities, website components, communication channels, scheduling tools, payment tools, and manual handoffs.

Every capability should record cost model, authentication method, supported actions, limits, risk, audience, and current approval status.

### 4. Playbook + Script Library
A playbook is a reusable solution pattern or proven growth pattern, not customer data. Scripts/functions implement deterministic steps inside those playbooks.

Example:

`new lead -> qualify -> reply -> schedule -> follow-up -> human exception`

A playbook can have many implementations depending on the customer's tools, permissions, cost priorities, and current native CoOperative coverage.

### 5. Growth Opportunity Engine
Continuously looks for credible ways to protect revenue, save money, increase current revenue, and create new revenue.

It should use business evidence, capacity, customer behavior, available capabilities, and proven playbooks to generate measurable proposals rather than generic ideas.

### 6. Mission Control
Executes approved workflows with least-privilege access, approval gates, logs, retries, human exception handling, and cost limits.

### 7. Connector Factory
Turns approved providers into reusable connection adapters using OAuth/OIDC, APIs, webhooks, imports, or supported migration mechanisms.

The connector hides provider-specific details behind stable CoOperative capability contracts.

### 8. Improvement Lab
Analyzes evidence across deployments, researches new capabilities, improves playbooks/scripts, finds cheaper providers/models, discovers reusable growth patterns, and proposes platform changes.

Hermes serves as the privileged Platform Operative / Improvement Engineer. It can research, prepare connectors/code, run tests, and propose changes. Its autonomy should expand only within governed risk classes.

## Product expansion areas

- inquiry and lead handling
- scheduling and reminders
- support triage
- payment/invoice follow-up
- lightweight websites and landing pages
- forms and customer intake
- stores/catalogs/commerce experiences
- social content planning, approval, and supported publishing
- email/SMS follow-up
- CRM-like customer records where a paid CRM is unnecessary
- customer reactivation
- retention and repeat purchase
- advertising experiments
- referral and affiliate programs
- memberships/subscriptions
- new service/product launch support
- AI-enabled services businesses can offer
- document processing
- internal knowledge retrieval
- recurring administrative workflows
- analytics, revenue, margin, and ROI measurement

## Cost philosophy

Do not recommend another subscription simply because one exists.

The planner should compare:

1. deterministic/native CoOperative code and existing playbooks;
2. existing customer tools;
3. CoOperative native capability;
4. direct API integration;
5. low-cost/open-source workflow infrastructure;
6. paid third-party SaaS.

AI routing follows the same principle: choose the cheapest approved intelligence that meets the required quality.

Each customer must operate inside a cost envelope. Customer revenue should cover customer-specific cost to serve, with a default target of at least 50% gross margin and preferably more when practical.

Choose based on total cost, reliability, maintenance, security, permissions, quality, and business value—not sticker price alone.

## Provider migration philosophy

CoOperative should meet the customer where they are:

`connect -> observe -> understand -> compare -> optimize -> mirror -> shadow-test -> replace -> migrate -> measure`

Do not force replacement before CoOperative can prove the alternative.

## Growth philosophy

CoOperative should not wait for the owner to know what to ask.

Where sufficient evidence exists, it should proactively surface opportunities such as:

`observe -> estimate economics -> select/adapt playbook -> approve -> small test -> measure -> expand/revise/stop -> retain evidence`

The goal is profitable business improvement, not maximum activity.

## Long-term AI direction

CoOperative should accumulate structured operational knowledge in code, playbooks, evidence, tests, and schemas so that models can be swapped without relearning the platform.

The same evidence should improve the ability of future CoOperative-specific models to select profitable playbooks, capabilities, and business actions.

Over time the platform should reduce external AI cost through cheaper models, open-weight options, self-hosted inference, and eventually specialized CoOperative models where evidence supports it.
