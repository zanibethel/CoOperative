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
- Workload workers authenticate to CoOperative with a server-configured node/shared token.
- Customer credentials and long-term worker memory are not sent to nodes.
- The current image queue sends only the prompt, signed short-lived reference URLs, and workload parameters required for that job.
- Community/public enrollment must not ship until nodes receive per-node credentials, signed workload manifests, stronger sandboxing, revocation, reputation, and accounting.

## Windows gaming-PC alpha

`workers/install-unison-windows.ps1` stores the alpha configuration in the current Windows user's environment and creates an on-logon scheduled task. The source folder must stay at the same path for this alpha installer.

The image worker defaults to idle-only mode on Windows. It will not claim a new queue job until the configured Windows inactivity threshold is met. A job already running is allowed to finish; preemption is a later phase.

Example from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\workers\install-unison-windows.ps1 `
  -Token "<private node token>" `
  -NodeName "Gaming PC" `
  -OwnerRef "family-private" `
  -NodeClass private `
  -IdleMinutes 5
```

Do not commit the token or paste it into source files.

## Next phases

1. **Private-node validation** — Mac + Windows nodes, heartbeat, hardware detection, idle-aware dispatch, failover, usage evidence.
2. **Capability scheduler** — match jobs to GPU/CPU/RAM, privacy class, business ownership, cost ceiling, availability, and reliability.
3. **Per-node enrollment** — one-time pairing code, unique credentials, rotation/revocation, signed manifests, secure auto-update.
4. **Isolation** — container/VM/WASM execution profiles and workload-specific sandboxes.
5. **Accounting** — measured compute units, electricity-aware estimates, owner cost avoided, community earnings, platform margin.
6. **Community beta** — opt-in providers, reputation, minimum pricing, payouts, abuse controls, dispute handling.
