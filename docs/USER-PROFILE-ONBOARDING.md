# Conversational User Profile Onboarding

Main CoOperative chat has an optional code-driven "Getting to know you" conversation for accounts whose structured profile has not been completed or dismissed.

## Behavior

- New accounts with no existing conversations start in the get-to-know-you conversation.
- For existing accounts with an incomplete profile, choosing **New chat** starts or resumes onboarding.
- CoOperative asks three questions at a time.
- The user can answer with numbered responses, one answer per line, or explicitly use:
  - `later` / `I'll tell you later` -> field status `deferred`
  - `skip` -> field status `unknown`
  - `skip onboarding` -> stops the questionnaire
- Skipped values stay unknown rather than being guessed.
- Deferred values stay deferred until a later explicit statement fills them.
- Normal chat can later fill or correct structured fields through the existing free response-support pass when the user explicitly states a matching value.

## Structured fields

The current questionnaire covers:

1. preferred name;
2. primary help wanted from CoOperative;
3. preferred response style;
4. current work/projects/roles;
5. near-term goals;
6. speed/quality/privacy/cost/control tradeoff priorities;
7. recurring workflows;
8. commonly used tools/services/devices;
9. boundaries and permission preferences;
10. important people/teams/business context the user chooses to share;
11. interests;
12. anything else useful for tailoring CoOperative.

These are stored in `cooperative_user_profile_fields` with status, source conversation/message, confidence, and timestamps.

`cooperative_onboarding_sessions` stores progress and the dedicated onboarding conversation.

## Runtime use

The private per-user `runtime-context.md` includes all structured profile fields with `known`, `unknown`, or `deferred` status.

Unknown and deferred values are explicitly marked so local/free/paid reasoning cannot treat missing profile data as known.

Current explicit user instructions always override older profile values. Later explicit corrections can update a known field.


## Adaptive personal / business intake

The first setup conversation now starts by asking whether the user wants a **Personal intake** or **Business intake**.

### Personal intake
Personal intake uses small batches (up to three questions) to establish durable user preferences, goals, work/project context, tools, recurring workflows, boundaries, interests, and other useful non-sensitive context.

### Business intake
Business intake first selects an existing business or creates a new business profile. It then asks small batches about:
- business identity and the user's role;
- customers and products/services;
- current goals;
- team size and recurring workflows;
- tools/services/devices;
- bottlenecks;
- actions that require human approval;
- current AI use and local/cloud preferences;
- technology/AI spend, budget ceilings, savings goals, and cost/quality preference.

Business answers are stored in `cooperative_business_profile_fields` and synchronized into the existing `businesses` record/profile where compatible.

### Skip, defer, and interruption
Every question is optional.
- `skip` / `pass` leaves the field unknown and prevents it from being repeatedly asked during the current intake.
- `later` on an individual answer marks it deferred.
- `pause intake` / `not now` pauses the flow.
- If the user asks an unrelated question while intake is active, intake yields immediately to normal chat without duplicating the message. The saved intake state remains resumable.
- Explicit commands such as `continue intake`, `start personal intake`, or `start business intake` resume the appropriate branch. Explicitly resuming a completed branch can revisit fields that were skipped/deferred.

### Natural profile completion
Normal chat continues to feed the response-support extractor. Explicit durable user statements can update the personal profile. When a business is explicitly active, explicit durable statements about that business can update its business profile. Ambiguous facts are not written to a business profile.

### Personal vs business scope
Chat defaults to **Personal / no business** rather than silently choosing the first business.

A user can explicitly select a business in the UI or name one of their known businesses in the request. CoOperative can resolve an exact named business into the request's business scope.

If scope would materially change the answer and is still unclear, model instructions require one short clarification such as:

> Is this personal, or is it for Business A, Business B, or Business C?

Once business scope is established, the business-specific structured fields are included in the private runtime Markdown context alongside personal context, without mixing one business into another.
