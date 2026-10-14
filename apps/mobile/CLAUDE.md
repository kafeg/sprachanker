# apps/mobile

The phone app (Tauri 2): the web app with the server's code running in its WebView over the phone's
own files — a course and its practice offline —, Whisper in the app's process. Why native and which
Whisper settings: `docs/decisions.md` (its lines on the phone app). What comes next: `docs/plan.md`,
"Phone app".

## Layout

```
src/                   # runs in the WebView, before the web app (bundled into dist/boot.js)
  boot.ts              # createApp over the phone's adapters; the web app's /api requests answered in
                       # the page (the session in the server's header: a page sends no cookie); media
                       # and recordings from the native scheme (`sprachankerFileUrl`), films whole as
                       # blob URLs (`sprachankerPlayable`); what the phone lacks says so
  native.ts            # the native side: files (listed, read through http://media.localhost, written,
                       # removed), Whisper
  files.ts             # the files as a tree kept in memory: the library's synchronous questions
  db.ts                # sql.js databases: read, migrated (the server's migrate.ts), written back after
                       # changes; nested transactions as savepoints
  profiles.ts          # the server's ProfileFiles: profile databases, recordings
  speech.ts            # the server's SpeechHost: Whisper in the app answering as whisper-server
scripts/
  build.ts             # dist/: the web app's build, boot.js before it, sql.js's wasm, whisper.html
  dev.ts               # dist/ on this Mac with the native side played over a folder (a browser test)
  phone.ts             # the phone looked after over adb: install (build + adb install), course (a
                       # course of this Mac's library pushed), practice (its AI practice brought up
                       # to date), models (Whisper's q8_0)
www/                   # the Whisper test page (dist/whisper.html; www/phrases: made by
                       # e2e/speech/phrases.ts, not committed)
src-tauri/
  src/lib.rs           # commands `load` (a model) and `transcribe` (16 kHz f32 samples)
  src/files.rs         # the data root (Android: /sdcard/Android/data/<id>/files): fs_* commands and the
                       # `media` scheme (files whole or by range; a recording by its id)
  native/asr.c         # whisper.cpp's C API for Rust: a model (on the GPU or not), an answer heard
                       # (greedy, temperature 0)
  build.rs             # on Android and iOS: asr.c compiled, whisper.cpp's static libraries linked
  tauri.conf.json      # app.sprachanker.mobile; the page from dist/
  capabilities/        # what the page may call
  icons/               # from apps/web/public/icon-512.png (`cargo tauri icon`)
  gen/android/         # the Android project Tauri generated, MainActivity's insets, microphone and
                       # Back added (its build outputs ignored)
  gen/apple/           # the iOS project Tauri generated (`cargo tauri ios init`; needs xcodegen and
                       # CocoaPods)
```

## Build and run (Android)

- Once: Rust with the Android targets, the Android NDK, `cargo install tauri-cli` (2.x), and
  whisper.cpp built for the phone — `bun run speech:android` builds it
  (`~/.cache/sprachanker/whisper.cpp-<version>/build-android-arm64`, the version in
  `native/whisper/VERSION`, the server's).
- `ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME` (17) set, from `apps/mobile`: `bun scripts/build.ts`,
  `cargo tauri android build --debug --apk --target aarch64`, then
  `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- `bun scripts/phone.ts install|course|practice|models` does the above (`ANDROID_SERIAL`: which phone).
  The app lists its files as it starts: files pushed show after it is started again.
- The data root is `/sdcard/Android/data/app.sprachanker.mobile/files/` (`adb push` reaches it):
  `library/<series>/` as on the Mac (a course bundle unpacked), `models/` (q8_0 on Android),
  `profiles/`, `server.sqlite`, `secret.key`.
- Only the page changed: touch `src-tauri/src/lib.rs` — the page is built into the binary, and cargo
  rebuilds it only when the Rust does.
- The debug build's WebView is open to Chrome's DevTools: `adb forward tcp:9334
  localabstract:webview_devtools_remote_<pid>`.

## Build and run (iOS simulator)

- `bun scripts/build.ts`, `cargo tauri ios build --debug --target aarch64-sim`, then
  `xcrun simctl install <device> src-tauri/gen/apple/build/arm64-sim/SprachAnker.app` and
  `xcrun simctl launch <device> app.sprachanker.mobile`.
- The data root is the app's Documents (`xcrun simctl get_app_container <device>
  app.sprachanker.mobile data`): a library copied there (`cp -c`: an APFS clone).
- iOS names the schemes, not hosts: the page is `tauri://localhost`, the files `media://localhost`.
- Its WKWebView answers the WebKit inspector: `ios_webkit_debug_proxy -s
  unix:<the simulator's webinspectord_sim.socket>` (Homebrew), then `Target.sendMessageToTarget`.
- Whisper for iOS: whisper.cpp's static libraries with Metal (and Accelerate), built from the same
  sources into `build-ios-sim` (`-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=OFF`;
  `build-ios` for a device: `iphoneos`); the model in Documents/models. The simulator's Metal cannot
  hold a model: there it runs on the CPU (`target_abi = "sim"`).

## Rules

- whisper.cpp is the server's version, linked through `src-tauri/native/asr.c`: no second copy of Whisper
  (whisper-rs bundles its own, and its build links macOS's libraries when cross-compiled from a Mac).
- Keep the Rust small: what needs the platform (Whisper, files, the microphone's permission); the app
  itself is the web app and the server's code in the WebView.
- Android's WebView plays nothing from a range answered by the app's scheme: films go to the player
  whole (blob URLs); a page's Request and Response carry no cookie: the session goes in a header.

## Planned

- A course installed in the app (from a bundle), the LLM through the Mac's server.
- iOS on an iPhone: whisper.cpp built for `iphoneos` (Metal), signing with an Apple ID.
- Sync with the Mac's server (`docs/decisions.md`).
