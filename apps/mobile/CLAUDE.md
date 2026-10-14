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
www/                   # the Whisper test page (dist/whisper.html; www/phrases: made by
                       # e2e/speech/phrases.ts, not committed)
src-tauri/
  src/lib.rs           # commands `load` (a model) and `transcribe` (16 kHz f32 samples)
  src/files.rs         # the data root (Android: /sdcard/Android/data/<id>/files): fs_* commands and the
                       # `media` scheme (files whole or by range; a recording by its id)
  native/asr.c         # whisper.cpp's C API for Rust: a model, an answer heard (greedy, temperature 0)
  build.rs             # on Android: asr.c compiled, whisper.cpp's static libraries linked
  tauri.conf.json      # app.sprachanker.mobile; the page from dist/
  capabilities/        # what the page may call
  icons/               # from apps/web/public/icon-512.png (`cargo tauri icon`)
  gen/android/         # the Android project Tauri generated, MainActivity's insets and microphone
                       # added (its build outputs ignored)
```

## Build and run (Android)

- Once: Rust with the Android targets, the Android NDK, `cargo install tauri-cli` (2.x), and
  whisper.cpp built for the phone — `bun run speech:android` builds it
  (`~/.cache/sprachanker/whisper.cpp-<version>/build-android-arm64`, the version in
  `native/whisper/VERSION`, the server's).
- `ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME` (17) set, from `apps/mobile`: `bun scripts/build.ts`,
  `cargo tauri android build --debug --apk --target aarch64`, then
  `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- The data root is `/sdcard/Android/data/app.sprachanker.mobile/files/` (`adb push` reaches it):
  `library/<series>/` as on the Mac (a course bundle unpacked), `models/` (q8_0 on Android),
  `profiles/`, `server.sqlite`, `secret.key`.
- Only the page changed: touch `src-tauri/src/lib.rs` — the page is built into the binary, and cargo
  rebuilds it only when the Rust does.
- The debug build's WebView is open to Chrome's DevTools: `adb forward tcp:9334
  localabstract:webview_devtools_remote_<pid>`.

## Rules

- whisper.cpp is the server's version, linked through `src-tauri/native/asr.c`: no second copy of Whisper
  (whisper-rs bundles its own, and its build links macOS's libraries when cross-compiled from a Mac).
- Keep the Rust small: what needs the platform (Whisper, files, the microphone's permission); the app
  itself is the web app and the server's code in the WebView.
- Android's WebView plays nothing from a range answered by the app's scheme: films go to the player
  whole (blob URLs); a page's Request and Response carry no cookie: the session goes in a header.

## Planned

- A course installed in the app (from a bundle), the LLM through the Mac's server.
- iOS: whisper.cpp with Metal / Core ML, the same commands.
- Sync with the Mac's server (`docs/decisions.md`).
