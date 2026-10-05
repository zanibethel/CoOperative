# Sandbox Branch Governance

CoOperative treats new platform code changes as testable sandbox work until owner review promotes one implementation.

## Core rule

A new issue or feature request that requires code must not change the default branch directly.

The default lifecycle is:

1. understand the issue in code-first routing;
2. create a bounded Repo Engineer task only when code changes are actually required;
3. create or continue a `sandbox/...` branch;
4. make the smallest portable change that can solve the issue;
5. run deterministic checks;
6. commit and push the sandbox branch for user testing;
7. revise that same sandbox branch when the test fails or needs adjustment;
8. compare it with other successful unmerged sandbox implementations;
9. include the branch in the owner review report;
10. allow merge eligibility only after explicit owner review;
11. perform the actual merge as a separate owner-controlled action.

Passing tests never means automatic merge.

## User testing

Sandbox branches are pushed to the repository but never to the default branch.

When Git-connected preview deployments are enabled, the pushed branch can receive its own preview deployment. This lets a user test an experimental fix while the current production/default branch continues independently.

If the user reports the sandbox fix does not work, a follow-up task should continue the same sandbox branch when practical rather than opening another unrelated implementation.

The task API accepts a prior task as the continuation source. The server validates that the prior task belongs to the same user/repository and that its branch is an approved `sandbox/` branch.

## Minimal and portable changes

Code prepared from a user request should be:

- as small as practical;
- evidence-driven;
- isolated from unrelated refactors;
- compatible with current architecture;
- reusable by other users where the underlying issue is shared;
- free of hard-coded user identity, business identity, account identifiers, or temporary one-user behavior unless the requirement is inherently user-specific.

Repo Engineer is instructed to prefer a shared abstraction over a one-user workaround.

Existing deterministic scope guards still limit write scope and reject broad or unsafe changes before files are written.


## Authority boundary

Platform-owner direction is authoritative product direction.

When a code-change request is authenticated as coming from the platform owner:

- it may intentionally change the default product behavior;
- a general UI change does **not** require an opt-in/default-off toggle unless the owner asks for one;
- the previous default does not need to be preserved merely because other users will see the change;
- implementation still uses bounded engineering, build/test verification, secret/security protections, and explicit merge/deploy actions;
- owner authority does not bypass destructive-action, billing, credential, authentication/security, or verification safeguards.

For **non-owner** user requests and suggestions, the sandbox/toggle/review rules below remain mandatory.

## Allowed sandbox scopes

Non-owner sandbox code changes are intentionally scoped.

### General UI changes from non-owner users

New non-owner UI/layout/navigation/interaction behavior must preserve the existing default experience for unrelated users.

The default rule is:

- new UI behavior is opt-in/toggleable;
- the toggle defaults **off** unless the owner explicitly requests otherwise;
- use an existing preference or feature-flag pattern when available;
- do not silently replace the current global flow;
- the plan must declare `UI_TOGGLE: <name>; DEFAULT: off; EXISTING_FLOW: preserved`;
- the deterministic scope guard blocks a general UI sandbox plan that does not show toggle/preference implementation evidence.

### User-invoked capabilities

These are explicitly allowed sandbox scopes because they add a capability only when the user chooses to use it:

- new OAuth/API/provider connection flows;
- reconnect/status/authorization surfaces for third-party services;
- report viewing, branch-review reports, analytics views, and audit/report readers.

These capabilities do not require an additional feature toggle merely to exist, but they must remain user-invoked and must not silently redirect or replace unrelated users' existing flow.

## Reusing other sandbox work

Before inventing another implementation, Repo Engineer receives a bounded list of successful unmerged sandbox candidates for the same repository.

Only technical branch evidence is shared with the coding worker:

- branch name;
- commit;
- changed files;
- diff/stat;
- check status;
- technical summary.

Requester identities and raw requester chat are excluded.

The worker may inspect those branch diffs and reuse the smallest proven pattern that satisfies the current objective. It must not copy unrelated changes.

A new user's branch can therefore mirror a proven implementation for testing without forcing that implementation into the default branch.

## Coding model policy

Repo Engineer defaults to the local **Quality** coding profile rather than the cheapest Fast profile.

The model policy is:

1. deterministic repository inspection and scope guards first;
2. local/owned Quality coding model for implementation;
3. deterministic checks and correction attempt;
4. if the quality path still cannot produce a verified safe change, record a stronger-model recommendation;
5. offer a higher-capability paid coding model only with explicit user approval and available funded balance;
6. never silently charge or escalate.

A paid model is therefore a deliberate recovery option for difficult coding work, not the default for every edit.

## Owner branch report

A platform-owner event is created as soon as a sandbox branch is opened.

Owner chat can answer branch-review questions directly from persisted branch/test state without calling AI, including:

- pending sandbox branches;
- branches with successful checks;
- branch reason/summary;
- changed files;
- whether the branch was pushed for testing.

The full Owner Improvement Report also includes sandbox branch candidates across users, without requester identities.

When several branches touch overlapping code, the branch-review endpoint identifies them as competing candidates so review can compare implementations rather than merging whichever was created first.

Default review cadence target: **every 7 days**, with branch-created events available immediately between reviews.

## Review and promotion

The owner branch review endpoint supports three decisions:

- `keep-testing`
- `approve-for-merge`
- `reject`

`approve-for-merge` is allowed only when the branch is pushed and its recorded checks passed.

Approval does **not** merge the branch. It only marks the branch eligible for a later explicit merge action.

This separation is intentional:

**prepare → test → compare → owner review → merge**

not:

**AI writes → AI merges**

## Main branch rule

No Repo Engineer, Debugger, connector builder, user chat, or background review process may automatically merge a sandbox branch into the repository default branch.

For non-owner work, a merge is acceptable only after explicit owner review has marked the chosen implementation `approved-for-merge`.

For owner-authoritative work, the owner's instruction already establishes product intent. The implementation must still be verified, and the actual merge remains a separate explicit owner-controlled action, but an additional toggle or owner-review approval step is not required.
