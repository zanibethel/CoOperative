# CoOperative

**Human + AI business operations.**

CoOperative learns how a business works, maps its processes, identifies work that can be improved or automated, and helps deploy cost-effective solutions while keeping people in control.

The long-term product is not just an automation builder. It is a governed learning system:

1. **Mission Briefing** — intake the business, goals, tools, constraints, and workflows.
2. **Intel** — map processes and find high-value opportunities.
3. **Capability Registry** — know which integrations, APIs, agents, and internal tools are currently available and what they cost.
4. **Playbooks** — turn successful solutions into reusable, versioned patterns.
5. **Missions** — deploy approved workflows and agents with explicit permissions.
6. **Evidence** — measure failures, time saved, cost, conversion, and human interventions.
7. **Improvement Lab** — research better options and propose platform/playbook improvements.
8. **Approval Gate** — no AI-authored production code update merges without tests and human review.

## v0.1 scope

Business intake → validated analysis → process map → ranked automation opportunities.

The first analyzer is intentionally deterministic. AI is added only after the application contract is stable and testable.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Zod runtime validation
- Supabase for auth, Postgres, RLS, and persistence
- Vercel deployment

## Run locally

```bash
npm install
npm run dev
```

Then visit `http://localhost:3000`.

## Architecture

```text
Business + connected tools
        |
        v
Mission Briefing / Intake
        |
        v
Validated business model
        |
        +-------------------+
        |                   |
        v                   v
AI Analyst          Capability Registry
        |                   |
        +---------+---------+
                  v
          Proposed Playbook/Mission
                  |
                  v
         Policy + Approval Gate
                  |
                  v
            Execution Engine
                  |
                  v
          Results + Evidence
                  |
                  v
      Playbook Library / Improvement Lab
                  |
                  v
       reviewed proposals / PRs only
```

See `docs/WEEK-01.md`, `docs/PLATFORM-VISION.md`, and `docs/LEARNING-LOOP.md`.
