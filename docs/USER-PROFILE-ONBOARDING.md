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
