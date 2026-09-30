# CoOperative AI Verified Lessons

- Long local inference should be asynchronous and persistent. Keeping the request open caused timeout risk; the queue architecture solved that.
- Closing CreatorHub must not cancel local work. Persisting jobs server-side allows the Mac to continue and the client to resume later.
- Cold model load/download time must be measured separately from warm inference latency.
- On a 16 GB M1, image, text-quality, and vision models should not all remain resident simultaneously.
- Model identity/configuration must be visible in result metadata so benchmarks are attributable.
- A compile fix is not sufficient if it removes promised behavior; functional requirements such as reopen/resume must be verified separately.
- Mobile navigation and mobile chat behavior require explicit validation rather than assuming desktop CSS works.
- A human-denied repo-agent proposal is durable negative evidence. Future tasks for the same owner/repository should receive concise rejection signals so the model does not blindly repeat the rejected approach.
- Bounded bug fixes need deterministic scope protection. A proposal that rewrites or deletes a large portion of an existing working file should be rejected before write/review and retried with explicit preserve-the-architecture feedback.
- A model claim that it "added tests" is not evidence by itself. Test claims should correspond to actual test/spec changes or explicit deterministic test output.
- `git diff --check` checks patch whitespace/conflict-marker style issues; it does not prove Python/TypeScript syntax, build success, tests, or runtime correctness. Reviewers must describe check semantics precisely.
- The 2026-09-30 Local Quality IP-Adapter fix attempt is the first canonical negative eval case: the agent replaced most of `workers/hf-image-worker.py` (including queue/MPS/model behavior) for a narrow two-reference bug. The correct behavior is a small evidence-based patch that preserves the worker architecture.
