# Project Intelligence Workflow — CoOperative

This file defines how to respond when the user asks:

> "What's new with CoOperative?"

or a clearly equivalent request inside a CoOperative project conversation.

## Goal

Return a current, project-specific intelligence brief that combines:
- the repository's current state;
- existing open considerations;
- relevant recent external developments;
- a concrete recommendation for this project.

Do **not** implement proposed upgrades until the user explicitly approves them (for example: "go", "apply it", "proceed", or an equally clear approval).

## Required workflow

### 1. Load project context first
Review, as relevant:
- `README.md`;
- `docs/THINGS_TO_CONSIDER.md`;
- architecture/operating-model docs;
- current code related to the finding;
- recent commits or implementation docs when they materially affect the recommendation.

Do not assume an older consideration still matches the code.

### 2. Find genuinely new information
Search current authoritative sources appropriate to the topic, such as:
- official model/provider release notes and documentation;
- AI infrastructure/provider announcements;
- security advisories;
- framework/platform changelogs;
- Supabase/Vercel/GitHub documentation when relevant;
- reputable technical reporting/newsletters for discovery.

Prefer primary sources for implementation claims.

### 3. Map each finding to CoOperative
For each meaningful update answer:
- **What changed?**
- **Where does it intersect our current architecture?**
- **Is it already handled?**
- **What problem/opportunity would it solve?**
- **What are the cost, risk, security, and lock-in implications?**
- **What is the recommended implementation path?**

### 4. Classify the recommendation
Use one of:
- No action;
- Monitor;
- Evaluate/prototype;
- Recommend implementation;
- Urgent fix.

### 5. Present before changing
The response should normally contain:
1. **New since last review**
2. **Why it matters to CoOperative**
3. **Current repo state**
4. **Possible solution**
5. **Recommended implementation**
6. **Risk/cost/effort**
7. **Decision requested**

If a previous item from `THINGS_TO_CONSIDER.md` has materially changed, call that out.

### 6. Approval gate
Do not modify production code, schemas, deployments, provider routing, pricing, or security policy merely because a finding looks beneficial.

After explicit approval:
1. re-check current code/docs;
2. implement using the repo's normal safety/governance patterns;
3. test/verify;
4. update the consideration status and implementation notes;
5. persist any durable architectural decision.

## Adding future findings

When a daily intelligence review or project conversation finds a credible future upgrade that is not yet approved:
- add or update it in `docs/THINGS_TO_CONSIDER.md`;
- include date, source, status, why it matters, possible solution, and recommendation;
- avoid duplicating an existing item;
- do not turn newsletter claims directly into implementation without verification.

This file is the durable contract for the "what's new with CoOperative?" workflow.
