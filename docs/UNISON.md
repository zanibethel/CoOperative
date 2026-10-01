# Unison — people-owned compute

Unison is CoOperative's distributed execution layer. A logical CoOperative worker keeps its identity, skills, memory, policies, and task history in the control plane. A Unison node contributes temporary execution capacity.

## Routing principle

Prefer compute in this order when capability, policy, privacy, reliability, and latency allow it:

1. customer/business-owned private nodes;
2. platform/operator-owned private nodes;
3. Unison community nodes;
4. commercial cloud or paid model/provider capacity.

Commercial infrastructure remains a fallback. The purpose of Unison is to let people and businesses own more of the productive infrastructure instead of forcing every workload through a centralized cloud provider.

## Alpha node protocol

The first vertical slice reuses CoOperative's working asynchronous image queue.

A node:

1. starts a workload worker;
2. sends a heartbeat to `POST /api/unison/nodes/heartbeat`;
3. reports platform, capability, hardware, resource limits, and policy;
4. checks local availability before claiming new work;
5. claims an eligible job through the existing queue;
6. completes the job through the existing completion endpoint;
7. continues heartbeating while online.

A node is treated as offline by the diagnostics API after 90 seconds without a heartbeat.

## Security boundary

The alpha is for trusted/private machines only.

- Node metadata is server-only. The table has RLS enabled and no `anon` or `authenticated` grants.
- New nodes enroll with a short-lived, one-time pairing code and receive a unique random node credential. Only the credential hash is stored server-side.
- Existing trusted workers may temporarily continue using the legacy shared worker credential during migration.
- Customer credentials and long-term worker memory are not sent to nodes.
- The current image queue sends only the prompt, signed short-lived reference URLs, and workload parameters required for that job.
- Community/public enrollment must not ship until nodes receive per-node credentials, signed workload manifests, stronger sandboxing, revocation, reputation, and accounting.

## Windows gaming-PC alpha

For a machine that does not already have the repository, use `workers/bootstrap-unison-windows.ps1`. It installs `uv` through Windows Package Manager when needed, downloads the worker into `%LOCALAPPDATA%\\CoOperative\\Unison`, pairs the node, creates an on-logon scheduled task, starts it in the background, and writes output to `unison.log`.

`workers/install-unison-windows.ps1` performs the local pairing/configuration step and can still be used directly from a repository checkout.

The image worker defaults to idle-only mode on Windows. It does not preload the image model, will not claim a new queue job until the configured Windows inactivity threshold is met, and releases loaded model/GPU memory when Windows becomes active again. A job already running is allowed to finish; preemption is a later phase. CPU/GPU percentage values are reported policy ceilings in this alpha; hard runtime enforcement is a later scheduler/runtime step.

Example bootstrap on a Windows PC:

```powershell
$bootstrap = "$env:TEMP\\unison-bootstrap.ps1"
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/bootstrap-unison-windows.ps1" `
  -OutFile $bootstrap

powershell -ExecutionPolicy Bypass -File $bootstrap `
  -PairCode "<one-time pairing code>" `
  -NodeName "Gaming PC" `
  -IdleMinutes 5
```

The pairing code is single-use. The installer exchanges it for a unique node credential and stores that credential in the current Windows user's environment. Do not commit either value to source files.

## Next phases

1. **Private-node validation** — Mac + Windows nodes, heartbeat, hardware detection, idle-aware dispatch, failover, usage evidence.
2. **Capability scheduler** — match jobs to GPU/CPU/RAM, privacy class, business ownership, cost ceiling, availability, and reliability.
3. **Enrollment hardening** — credential rotation/revocation UI, signed workload manifests, secure auto-update, and device attestation where useful.
4. **Isolation** — container/VM/WASM execution profiles and workload-specific sandboxes.
5. **Accounting** — measured compute units, electricity-aware estimates, owner cost avoided, community earnings, platform margin.
6. **Community beta** — opt-in providers, reputation, minimum pricing, payouts, abuse controls, dispute handling.
