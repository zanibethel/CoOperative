# Android CoOperativeLocalAI

CoOperativeLocalAI is the Android client, private Unison node, and future
on-device AI/device-assist runtime for the same CoOperative profile and
conversation system.

## Product rule

Android is not a separate AI product. It is another CoOperative surface with a
device-specific capability set.

The control plane should continue to own:

- profile identity and authorization;
- conversation and project state;
- Model Mixer and routing policy;
- cost/balance policy;
- agent planning;
- model/capability registry;
- Unison scheduling and evidence.

The phone owns only device-local capabilities that it has explicitly been
allowed to use.

## Routing target

```text
deterministic CoOperative code/playbook
  -> this Android device (when capable)
  -> authorized personal/business node
  -> other owned/Unison compute
  -> strict-free cloud/model route
  -> funded paid fallback
```

## Android phases

### Phase A — native node foundation

Implemented by the first alpha under
`apps/android/CoOperativeLocalAI`.

- pair to existing Unison control plane;
- store credential in Android Keystore;
- foreground node mode;
- heartbeat + hardware/capability report;
- local-inference interface;
- truthful capability advertising.

### Phase B — on-device text inference

After measuring the first physical test phone:

- choose a model size that fits measured RAM/CPU/GPU/NPU capability;
- add model download/version management;
- add local token streaming;
- report model/runtime and benchmark evidence in node resources;
- advertise `text_generation` and `allowText=true` only after a successful
  self-test;
- prefer local inference for qualifying Personal AI requests.

### Phase C — screen assist

Add separately permissioned Android integrations:

- MediaProjection for user-approved screen capture sessions;
- AccessibilityService for supported UI-tree inspection/actions;
- observation -> reason -> proposed action -> user approval -> action ->
  verification loop;
- clear per-capability switches and audit evidence.

Screen observation and device actions must remain separable. Enabling screen
understanding must not silently enable taps, typing, or navigation.

### Phase D — mobile Unison contribution

Only after local personal use is reliable:

- charging/Wi-Fi/battery/thermal gates;
- personal work always outranks contributed/community work;
- opt-in contribution scopes;
- resource ceilings and thermal protection;
- accounting/evidence compatible with desktop Unison nodes.

## Capability contract

A client must only report capabilities it can actually perform now. Planned
features do not appear in the heartbeat capability list.

Examples:

```text
android_node
local_chat_client
device_runtime_alpha

# later, only after verified
text_generation
vision_understanding
screen_capture
ui_tree
ui_actions
camera
microphone
files
```

This preserves router correctness across web, desktop, Android and future iOS
clients.
