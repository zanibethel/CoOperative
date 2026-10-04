# Conversational Personal + Business Onboarding

Main CoOperative chat begins with an optional code-driven setup for each logged-in account whose onboarding state has not been started.

## First choice

The first prompt asks whether the user wants:

- **Business intake** — learn or create a business profile and capture business-specific workflows, tools, goals, costs, approvals, and AI/automation preferences.
- **Personal setup** — learn the user's preferred name, response style, goals, recurring context, tools, boundaries, interests, and useful history.

The user can also ignore the setup and make a normal request. CoOperative pauses onboarding rather than blocking the request.

## Shared behavior

- Ask only a few questions at a time, normally three.
- `skip` leaves a field `unknown`.
- `later` / `I'll tell you later` marks a field `deferred`.
- Unknown/deferred values are never guessed.
- Already saved answers survive a pause.
- `continue onboarding`, `resume personal setup`, or `resume business intake` can return to the flow later.
- Normal conversation continues filling explicit durable personal/business fields when the user naturally provides an answer later.
- Current explicit user instructions override older saved values.

## Personal setup

The personal flow currently covers preferred name, primary help, response style, work/projects, goals, tradeoff priorities, recurring workflows, tools/services/devices, boundaries, important context, interests, and other useful tailoring context.

Values are stored in `cooperative_user_profile_fields` with source/provenance, status, confidence, and timestamps.

## Business setup and intake

If the user selects Business intake:

- Existing owned businesses are listed so the user can choose one.
- The user can instead choose **Set up a new business**.
- A new business starts with business name, business type/industry, and approximate team size.
- Business name is the only value required to create the workspace; other values may remain unknown/deferred.
- After selection/setup, CoOperative asks the existing deterministic business intake questions in batches of up to three.

Business intake covers structured fields such as customer description, lead sources, daily/repetitive work, tools, bottlenecks, approval areas, website/inquiry flow, marketing/social, booking/scheduling, current AI usage/services/spend, available business compute, local-AI preference, technology spend/budget, CoOperative managed-spend limits, savings targets, and cost priority.

Existing `organizations` / `businesses` remain the canonical business records. Intake provenance remains in the business profile metadata.

## Normal-conversation learning

The response-support pass can map explicit high-confidence statements into both personal structured profile fields and the currently selected business's structured intake fields. It never assigns a statement to a business when business scope is unclear.

Paid responses can also contribute the same structured updates after a successful funded run; model choice does not change ownership/provenance rules.

## Personal vs business task clarification

A chat conversation may have no business selected. When a request could reasonably be personal or business-related and business context materially affects the output, CoOperative asks before executing.

Example: `I need to create an image for next week's event.`

With saved businesses, CoOperative asks whether it is personal or related to one of the saved businesses.

The pending original request is stored in `cooperative_context_clarifications`. If the user answers personal, the original request resumes as personal. If the user answers with a business name/number, it resumes with that business context. If the user instead makes an unrelated new request, the pending clarification is dismissed and the new request proceeds normally.

When a saved business is selected, its ID is persisted on `local_ai_conversations.business_id` and propagated into local/free/paid text jobs so memory extraction, business facts, runtime context, and paid handoffs remain attached to the right business.

## Runtime context

The private per-user `runtime-context.md` includes structured personal profile fields with `known`, `unknown`, or `deferred` status, along with durable memory and model outcome history.

Selected business context is also supplied by the code-authored business-context layer. Missing values remain explicitly unknown rather than being inferred.

## Tables

- `cooperative_user_profile_fields` — personal structured fields.
- `cooperative_onboarding_sessions` — mode, phase, progress, selected business, draft setup answers, pause state.
- `cooperative_context_clarifications` — pending/resolved personal-vs-business task scope.
- `organizations` / `businesses` — business workspaces and structured business intake.
- `local_ai_conversations.business_id` — persisted conversation business scope.
- `text_inference_jobs.business_id` — business provenance across local/free/paid reasoning.
