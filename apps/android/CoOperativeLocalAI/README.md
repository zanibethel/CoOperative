# CoOperativeLocalAI Android alpha

This directory contains the native Android client, private Unison node, and on-device AI runtime for CoOperative.

## Alpha 2 scope

Alpha 1 proved native pairing and heartbeats on a Samsung Galaxy S10-class device running Android 10 on arm64-v8a with 8 CPU threads and about 7.5 GB RAM.

Alpha 2 adds:

- LiteRT-LM 0.17.0 on-device text inference.
- A separately downloaded starter model: `litert-community/Qwen3-0.6B-int4`.
- The no-think INT4 model file is about 347 MB and stays outside the APK.
- Local model download progress.
- A local-only self-test before CoOperative is allowed to route text work.
- Benchmark/model evidence in the existing Unison heartbeat shape.
- A direct local prompt box for offline validation.
- Personal-only CoOperative text queue polling after verification.
- No community/general Unison contribution yet.
- No AccessibilityService, screen capture, camera, microphone, or autonomous device actions yet.

The node advertises `text_generation` and sets `allowText=true` only after the model successfully initializes and returns a self-test response on that physical phone.

## Build

Requirements:

- Android SDK 37
- JDK 17
- Gradle 9.6.0
- AGP 9.4.0
- Kotlin 2.4.10 compatibility mode for LiteRT-LM

From this directory:

```bash
gradle :app:assembleDebug
```

GitHub Actions builds the APK and publishes the current alpha behind:

```text
https://co-operative-mu.vercel.app/download/android
```

## Phone flow

1. Install or update CoOperativeLocalAI.
2. Pair the phone with the existing Unison pairing flow.
3. Start the private node.
4. Tap **Download local model (~347 MB)**.
5. Tap **Run local self-test**.
6. Only after the self-test succeeds does the heartbeat expose local text capability.
7. Use **Run locally** to confirm a prompt is answered entirely on the phone.

## Routing behavior

The Android alpha polls only personal text jobs. It is not yet a community compute contributor.

```text
CoOperative deterministic code
  -> verified Android local model
  -> linked private Mac/PC nodes
  -> eligible free/community routes
  -> paid fallback when authorized
```

## Security notes

- Pairing codes are never stored.
- The node credential is encrypted using an AES-GCM key held by Android Keystore.
- Models are stored in app-private storage.
- Cleartext HTTP is disabled.
- Node mode is user-started and always has a visible foreground-service notification.
- Screen observation and UI actions will be separate explicit permissions.
