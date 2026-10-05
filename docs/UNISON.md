# Unison — people-owned compute

Unison is CoOperative's distributed execution layer. A logical CoOperative worker keeps its identity, skills, memory, policies, and task history in the control plane. A Unison node contributes temporary execution capacity.

## Routing principle

Prefer compute in this order when capability, policy, privacy, reliability, and latency allow it:

1. customer/business-owned private nodes;
2. platform/operator-owned private nodes;
3. Unison community nodes;
4. commercial cloud or paid model/provider capacity.

Commercial infrastructure remains a fallback. The purpose of Unison is to let people and businesses own more of the productive infrastructure instead of forcing every workload through a centralized cloud provider.


For signed-in CoOperative chat, deterministic code remains above the compute hierarchy. The intended profile route is:

```text
CoOperative code/playbooks
  -> matching authorized personal/business node
  -> other qualified owned/free compute
  -> eligible strict-free/community model
  -> profile-funded paid model
```

An installed node is an **added capability of the same CoOperative chat/profile**. It should not create a separate primary chat product. When a profile is linked to a healthy capable node, that node becomes the preferred AI executor for that profile after deterministic code. The same browser/mobile conversation can therefore become faster, more private, and cheaper simply because the user's own hardware is available.

If the node is offline or lacks a required capability, the conversation remains the same and the router may use the next allowed route. Paid fallback remains impossible unless the profile has sufficient funded balance and the request policy permits the spend.


Profile Web access is also shared with linked nodes. Off is the default. For Windows text jobs, Auto/Always can authorize the node's public web-search helper before local inference; only the search query/results leave the PC, while model inference stays local. Search queries containing credential-like material are blocked before external submission, and unsafe/private/executable result URLs are filtered.

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

Windows text setup is hardware-adaptive. The installer now inventories Windows display adapters instead of relying only on `nvidia-smi`, so AMD and Intel GPUs are visible to the node planner. Older AMD cards such as the Radeon RX 590 are normalized around the Windows AdapterRAM reporting limitation and are marked for Ollama's Vulkan path. After Ollama is installed, the setup benchmarks the provisional Fast and Quality models on the actual PC, records tokens/second, total latency, Ollama-reported VRAM residency, and GPU-offload ratio, then rewrites the model plan if Quality is too slow or is not being offloaded as expected. The contributor dashboard surfaces the measured acceleration path and benchmark results.

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


## One PC, multiple private users

A machine-wide Windows install represents one physical Unison node. Additional
Windows users do not install a second worker, Ollama runtime, model cache, or
hardware benchmark. Running the installer from another Windows profile creates a
separate authorized-user link to the existing node.

The first contributor who pairs a physical node is its device owner and remains
the contributor/earnings owner. Additional authenticated CoOperative users are
linked as members and can later be promoted to device admin by the owner.

Each linked Windows profile receives its own opaque profile token stored under
that Windows user's local AppData. CoOperativeLocalAI opens with that token in a
URL fragment, stores it only in that browser profile, and removes the fragment
from the visible URL. Hosted Personal AI history requires both the machine node
credential and the current Windows profile token. A machine credential by itself
is intentionally insufficient to read any user's hosted history.

Remote/mobile Personal AI uses the signed-in CoOperative user's node membership
rather than the node's contributor owner. Conversations remain keyed to that
user, so two people may use the same physical PC without sharing conversation
history.


The long-term product should converge this remote/mobile Personal AI behavior with
the main CoOperative chat rather than maintaining a permanently separate Personal
AI product surface. Node membership should become execution metadata on the same
profile/conversation contract.

Personal requests from any authorized user use the node's priority personal
queue before community work. Community work remains tied to the physical node
and its contributor owner.

Device owners/admins may revoke member access; revocation also invalidates that
user's Windows-profile tokens and clears the node as their preferred Personal AI
device. Owner access cannot be removed through the member-management endpoint.
