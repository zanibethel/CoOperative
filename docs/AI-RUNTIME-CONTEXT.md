# Per-user Runtime AI Context Markdown

## Goal

Every main CoOperative chat request that reaches local/owned or strict-free reasoning should receive a current, private, database-backed context document instead of relying on a model's hidden memory.

The document is rendered as Markdown, saved privately in Supabase Storage, and injected into the model request as subordinate runtime context.

## Privacy and tenancy

Per-user rendered Markdown is **not** committed to GitHub.

The repository contains only the generator/template code.

Rendered files live in the private `cooperative-ai-context` storage bucket under an owner-isolated path:

`owners/<owner-ref>/...`

The service-role backend is the writer. The runtime document is not public.

## Runtime file

On each main CoOperative chat request, code rebuilds:

`owners/<owner>/current/runtime-context.md`

The file includes:

- generation timestamp;
- owner/conversation scope;
- current request type;
- current code-authored CoOperative business/model policy and revision;
- latest active structured memory, grouped by memory type and timestamp;
- recent successful, failed, and cancelled text/vision model executions;
- execution tier: owned/local, strict-free cloud, or paid;
- provider/model, request class, latency, token evidence, fallback evidence, and errors;
- paid text cost evidence from the profile AI reservation ledger;
- recent paid/free media outcomes, including provider/user charge evidence when recorded;
- the most recent periodic reasoning review.

The prompt receives a bounded version of the Markdown. The full private document remains saved in storage.

Current user instructions and code-authored policy always outrank memory, prior model output, and review guidance.

## Outcome snapshots

Terminal text/vision executions create immutable dated evidence files:

`owners/<owner>/outcomes/YYYY-MM-DD/<timestamp>_<job-id>.md`

Each snapshot records:

- date/time;
- conversation/job;
- request type;
- success/failure/cancelled;
- execution tier;
- provider/model;
- latency and token counts;
- actual paid cost when recorded;
- route reason;
- failure evidence.

This makes model history inspectable without treating an earlier model answer as fact.

## Periodic reasoning review

CoOperative periodically reviews accumulated execution evidence with `openrouter/free`.

A review runs only when enough new terminal evidence exists:

- first review after at least 5 outcomes;
- then after 10 new outcomes; or
- after at least 3 new outcomes when the last review is at least 24 hours old.

The review considers text, vision, and media model outcomes.

It saves:

`owners/<owner>/reviews/current.md`

and a structured row in `cooperative_reasoning_reviews`.

The review proposes:

- reasoning guidance for future prompts;
- routing lessons based on successful/unsuccessful executions;
- deterministic code/playbook improvements worth human/code review.

Review output is advisory. It cannot weaken or replace:

- current user instructions;
- code-authored system policy;
- privacy/tenant boundaries;
- safety rules;
- spend ceilings;
- approval gates.

A local request using a hard required-node route does not trigger the external free review pass.

## Database provenance

`text_inference_jobs` stores:

- `context_document_path`;
- `context_document_generated_at`.

`cooperative_context_documents` indexes rendered runtime, outcome, and review files.

`cooperative_reasoning_reviews` stores the structured evidence review.

Existing `cooperative_memories` remains the canonical structured memory store. Markdown is a rendered context/artifact layer, not the source of truth.

## Learning contract

The system learns conservatively:

1. user conversation produces a local/free response;
2. durable memory candidates are extracted with provenance;
3. explicit high-confidence owner statements may become active memory;
4. model successes/failures are recorded as execution evidence;
5. periodic reviews identify repeated patterns;
6. future prompts receive relevant memory + recent outcome/review evidence;
7. repeated proven patterns should eventually move into deterministic code/playbooks.

Model-generated review notes never silently rewrite repository code or global system policy. They create evidence-backed improvement candidates for subsequent code review.
