# Week 1 — Mission Briefing → Process Map → Proposed Missions

## What you are learning

This week is about **contracts, data flow, and boundaries**, not flashy AI.

A production AI system should be understandable as a pipeline:

1. A user provides untrusted input.
2. We validate it against a schema.
3. One component analyzes it.
4. That component returns a known output shape.
5. The UI renders only that known shape.
6. Persistence stores the input and output under the correct organization.
7. Later, the analyzer can compare the business against approved capabilities and playbooks.

The AI model is only one replaceable component inside that pipeline.

## Data flow in v0.1

`/intake form`
→ `POST /api/analyze`
→ `BusinessIntakeSchema.safeParse()`
→ `deriveDemoAssessment()`
→ `AssessmentResult`
→ render process map + proposed mission cards

## Why deterministic first?

If we begin with an LLM, every bug can be blamed on “AI weirdness.” By beginning with a deterministic analyzer:

- the request/response contract is testable;
- the UI can be built independently;
- scoring logic is visible;
- failures are easier to reproduce;
- the future AI implementation can be compared against a baseline.

Later the internal analyzer becomes:

`BusinessIntake → capability/playbook context → LLM structured output → AssessmentResultSchema.parse()`

Nothing outside the analyzer needs to care which model produced the result.

## New platform contracts

`CapabilitySchema` describes something CoOperative can use.

`PlaybookSchema` describes a reusable solution pattern.

`ImprovementProposalSchema` describes a governed change suggested by the system.

These are contracts before they are features. That is deliberate.

## Your Week 1 questions

1. Why do we validate the browser payload again on the server?
2. What is the difference between a TypeScript type and runtime validation?
3. Why should the AI return structured data instead of prose?
4. Why does every business record need an organization ID?
5. Why is a deterministic baseline useful before an LLM?
6. What is the difference between a capability and a playbook?
7. Why should evidence improve a playbook rather than directly changing production code?

## Build goals

- [x] Dedicated GitHub repository.
- [x] Define runtime schemas with Zod.
- [x] Create a typed API boundary.
- [x] Create a deterministic analysis baseline.
- [x] Render a process map.
- [x] Render ranked automation opportunities.
- [x] Define capability, playbook, and improvement-proposal contracts.
- [x] Draft the governed learning loop.
- [ ] Create/connect a Supabase project.
- [ ] Implement authentication and safe organization onboarding.
- [ ] Persist assessments.
- [ ] Persist capability registry and playbook evidence.
- [ ] Add automated tests for the contract and scoring.
- [ ] Deploy to Vercel.
