# CoOperativeLocalAI Android alpha

This directory is the first native Android client + private Unison node for CoOperative.

## Alpha 1 scope

- Stable Android node identity.
- One-time pairing through the existing `/api/unison/nodes/pair` contract.
- Node credential encrypted with Android Keystore.
- User-started foreground node service.
- 20-second heartbeat through the existing `/api/unison/nodes/heartbeat` contract.
- Hardware report: Android release, primary ABI, CPU thread count, and RAM.
- Stable `LocalInferenceEngine` boundary for the next on-device-model phase.
- No AccessibilityService, screen capture, microphone, camera, files, or autonomous device actions yet.

The node deliberately reports `allowText=false` and `allowImage=false` until an on-device model is actually installed and verified.

## Build

Requirements:

- Android SDK 37
- JDK 17
- Gradle 9.4.1 or Android Studio with compatible AGP 9.4 support

From this directory:

```bash
gradle :app:assembleDebug
```

The debug APK will be written under:

```text
app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions also builds the debug APK and uploads it as the
`CoOperativeLocalAI-debug` artifact.

## First physical-phone test

1. Install the debug APK.
2. Open CoOperativeLocalAI.
3. Record the hardware block shown on the home screen.
4. Generate a one-time Unison pairing code from the existing CoOperative owner/node flow.
5. Enter it in the Android app and pair.
6. Tap **Start private node**.
7. Confirm the phone appears in Unison diagnostics and remains online while node mode is enabled.

Once the hardware report is known, select a mobile model/runtime profile. The initial intended path is a quantized small LLM using a supported Android edge runtime, implemented behind `LocalInferenceEngine`.

## Security notes

- Pairing codes are never stored.
- The returned node credential is encrypted using an AES-GCM key held by Android Keystore.
- Cleartext HTTP is disabled.
- Node mode is user-started and always has a visible foreground-service notification.
- Device-assist capabilities will require explicit, separate user controls.
