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
