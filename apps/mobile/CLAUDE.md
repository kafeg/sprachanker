# apps/mobile

The phone app (Tauri 2): a proof so far — Whisper in the app's own process on Android, timed on a
test page. Why native and which Whisper settings: `docs/decisions.md` (its lines on the
phone app). What comes next: `docs/plan.md`, "Phone app".

## Layout

```
www/                   # the test page: a model loaded, the phrases heard and timed (www/phrases: made
                       # by e2e/speech/phrases.ts, not committed)
src-tauri/
  src/lib.rs           # commands `load` (a model file) and `transcribe` (16 kHz f32 samples; raw, or a
                       # JSON array of bytes where the IPC carries no raw body — Android)
  native/asr.c         # whisper.cpp's C API for Rust: a model, an answer heard (greedy, temperature 0)
  build.rs             # on Android: asr.c compiled, whisper.cpp's static libraries linked
  tauri.conf.json      # app.sprachanker.mobile; the page from www/
  capabilities/        # what the page may call
  icons/               # from apps/web/public/icon-512.png (`cargo tauri icon`)
  gen/android/         # the Android project Tauri generated (its build outputs ignored)
```

## Build and run (Android)

- Once: Rust with the Android targets, the Android NDK, `cargo install tauri-cli` (2.x), and
  whisper.cpp built for the phone — `bun run speech:android` builds it
  (`~/.cache/sprachanker/whisper.cpp-<version>/build-android-arm64`, the version in
  `native/whisper/VERSION`, the server's).
- `ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME` (17) set, from `apps/mobile`:
  `cargo tauri android build --debug --apk --target aarch64`, then
  `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- Models go to `/sdcard/Android/data/app.sprachanker.mobile/files/` (`adb push`): q8_0 on Android.
- Only the page changed: touch `src-tauri/src/lib.rs` — the page is built into the binary, and cargo
  rebuilds it only when the Rust does.
- The debug build's WebView is open to Chrome's DevTools: `adb forward tcp:9334
  localabstract:webview_devtools_remote_<pid>`.

## Rules

- whisper.cpp is the server's version, linked through `src-tauri/native/asr.c`: no second copy of Whisper
  (whisper-rs bundles its own, and its build links macOS's libraries when cross-compiled from a Mac).
- Keep the Rust small: what needs the platform (Whisper, files, the microphone's permission); the app
  itself is the web app and the server's code in the WebView.

## Planned

- The web app and the server inside the WebView (sqlite-wasm), a course and its practice offline.
- iOS: whisper.cpp with Metal / Core ML, the same commands.
- Sync with the Mac's server (`docs/decisions.md`).
