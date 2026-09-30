# CoOperative AI Verified Lessons

- Long local inference should be asynchronous and persistent. Keeping the request open caused timeout risk; the queue architecture solved that.
- Closing CreatorHub must not cancel local work. Persisting jobs server-side allows the Mac to continue and the client to resume later.
- Cold model load/download time must be measured separately from warm inference latency.
- On a 16 GB M1, image, text-quality, and vision models should not all remain resident simultaneously.
- Model identity/configuration must be visible in result metadata so benchmarks are attributable.
- A compile fix is not sufficient if it removes promised behavior; functional requirements such as reopen/resume must be verified separately.
- Mobile navigation and mobile chat behavior require explicit validation rather than assuming desktop CSS works.
