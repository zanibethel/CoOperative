# CoOperative AI Durable Decisions

## Local-first inference
Local execution is preferred when capable. Hosted inference is an escalation path, not an automatic fallback.

## Persistent outbound workers
Long-running local inference uses outbound polling from the Mac to CoOperative production. Do not reintroduce a Cloudflare tunnel unless a future requirement genuinely needs inbound connectivity.

## Model governance
Models/providers are replaceable. Candidate models should be benchmarked against real workloads and promoted only when measurably better.

## Learning
Do not blindly retrain on every interaction. Prefer retrieval, explicit project memory, better prompts/tools, curated evidence, and later optional adapters/LoRA when justified and rights allow.

## Agent design
Agents are bounded capability profiles, not independent uncontrolled bots. They share replaceable local models and receive only the tools, repository scope, memory, and permissions needed for their task.

## Code-first automation
If AI reasoning discovers a repeatable solution, move the stable portion into deterministic code/playbooks so future tasks require less model reasoning.

## Human approval
Keep high-impact changes human-gated, especially production deployment, destructive operations, secrets/auth/billing/access-control, risky schema changes, and broad changes that could disrupt other working processes.

## CoOperative is the reasoning governor
Useful intelligence is the combination of owner/business direction, evidence, deterministic tooling, retrieval, qualified models, planning, verification, approval policy, execution capability, and measured outcomes. No individual model is the platform authority.

## Reasoning envelope
Meaningful AI calls should inherit the CoOperative Reasoning Envelope defined in `docs/ai/AI_EXECUTOR_CHARTER.md`. External and business-owned AI must receive applicable direction/evidence and remain subordinate to CoOperative policy and approval boundaries.

## Business-owned AI
A customer may contribute qualified AI compute they already own or pay for. CoOperative should use it when programmatic access is supported, authorized, benchmark-qualified, policy-compatible, and economically sensible. Do not assume a consumer AI subscription includes API/automation access.

## AWS direction
AWS is a planned owned/controlled execution target to remove the owner's Mac as a required runtime dependency and support stronger models. Introduce AWS first as additional compute. Do not migrate working Vercel/Supabase infrastructure merely for consolidation; require measured economic/operational benefit.

## Cost-optimization product direction
CoOperative should understand what a business pays for, what each service actually provides, identify credible lower-total-cost or higher-value replacements, prepare safe migrations, verify outcomes, and measure realized savings.

Where appropriate, CoOperative may support a shared-savings commercial model in which the customer retains the majority of verified savings and CoOperative earns an agreed portion. Hypothetical savings are not realized savings.

## First business optimization pilot
The current intended first real cost-migration pilot is the owner's father's radio-station hosting, reportedly around $1,500/year, after exact provider, plan, capabilities, traffic, licensing/reporting requirements, and current cost are verified.

## Canonical roadmap
The current execution sequence and end-state definition live in `docs/END-STATE-ROADMAP.md`. New platform work should be compared against that roadmap and explicit newer owner decisions.
