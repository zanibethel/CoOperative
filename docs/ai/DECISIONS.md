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

## Unison Windows distribution

The current CMD/PowerShell installer is a temporary bootstrap/debug path, not the intended public product. After the first Windows Unison node is proven reliable, package the proven logic into a branded, Authenticode-signed **CoOperative Unison Setup.exe** (or MSI where appropriate).

The normal user flow should not require PowerShell, pairing-code copy/paste, or raw scripts. Installation should verify a real node heartbeat before claiming success. Prefer a per-user tray/background agent for node status, pause/resume, restart, repair, update, dashboard access, and uninstall, while preserving outbound-only networking and per-node credentials. Keep raw scripts only as advanced/debug fallbacks.

## Canonical roadmap
The current execution sequence and end-state definition live in `docs/END-STATE-ROADMAP.md`. New platform work should be compared against that roadmap and explicit newer owner decisions.

## Canonical business economic model
The governing commercial model is defined in `docs/BUSINESS-ECONOMIC-MODEL.md`. A business's current outside spend and explicit approved budget establish the economic envelope CoOperative must work inside. CoOperative should find equal-or-better lower-total-cost alternatives, including self-installed systems, business-owned compute, Unison nodes, connected AI, native capability, and qualified external providers.

Customer savings and CoOperative profitability are simultaneous constraints. Do not create customer savings by operating structurally losing routes. Track customer charges separately from AI/API cost, infrastructure, Unison/node payouts, human payouts, and other variable cost. Enforce applicable margin floors.

Savings must remain separated into projected, verified, and realized. Do not recommend cancellation of a working legacy service until the replacement has been proven through appropriate side-by-side/shadow testing, reconciliation, and approval.

The intended business experience is conversation-first: Chat is the main control surface, with Projects/Businesses, Connected Services, Tools/Capabilities, Budget & Savings, Approvals, and Activity/Evidence surrounding it.
