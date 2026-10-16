# apps/mobile

The phone app (Tauri 2): the web app with the server's code running in its WebView over the phone's
own files, Whisper in the app's process. It stands alone (docs/decisions.md): the same code as the
computer's — the server's storage (`packages/server/src/storage/`), the importers, the web UI — over
the phone's adapters: files (course-kit's DataFs), requests to other hosts, SQLite (sql.js), zstd.
What comes next: `docs/plan.md`, "Phone app".

## Layout

```
src/                   # runs in the WebView, before the web app (bundled into dist/boot.js)
  boot.ts              # createApp over the phone's adapters and the server's storage (Android); the web
                       # app's /api requests answered in the page (the session in the server's header:
                       # a page sends no cookie); files in and out (`sprachankerTransfer`: a file chosen
                       # sent as it is read, an export saved into Downloads); a download or a transfer
                       # kept going while the app is put away (`work`); media and recordings from the
                       # native scheme (`sprachankerFileUrl`), films whole as blob URLs
                       # (`sprachankerPlayable`)
  bridge.ts            # the native bridge (Native.kt): its methods, bytes as Latin-1, later answers
  phone-fs.ts          # course-kit's DataFs over the bridge: folders' entries kept, a change noting its
                       # own entry; parts read by the scheme's `?part=`, small files at once
  net.ts               # `fetch` by the native side (no CORS): the server's code only, never the page's
  sql.ts               # sql.js for the storage: an .apkg's database (zstd by fzstd), a profile file's
                       # copied, opened, made ready (the server's profile-db.ts)
  native.ts            # the native side's Tauri commands: files (listed, read through
                       # http://media.localhost, written, removed: iOS), Whisper
  files.ts             # the app's files as the server's ProfileFiles and the databases see them: over
                       # the DataFs (Android, `filesOver`), or a tree kept in memory (iOS)
  db.ts                # sql.js databases: read, migrated (the server's migrate.ts), written back after
                       # changes; nested transactions as savepoints
  profiles.ts          # the server's ProfileFiles: profile databases, recordings
  speech.ts            # the server's SpeechHost: Whisper in the app answering as whisper-server
scripts/
  build.ts             # dist/: the web app's build, boot.js before it, sql.js's wasm, whisper.html
  dev.ts               # dist/ on this Mac with the native side played over a folder (a browser test)
  phone.ts             # the phone looked after over adb: install (build + adb install), course (a
                       # course of this Mac's library pushed), practice (its AI practice brought up
                       # to date), models (Whisper's q8_0), page (an expression in the app's WebView)
www/                   # the Whisper test page (dist/whisper.html; www/phrases: made by
                       # e2e/speech/phrases.ts, not committed)
src-tauri/
  src/lib.rs           # commands `load` (a model) and `transcribe` (16 kHz f32 samples)
  src/files.rs         # the data root (Android: /sdcard/Android/data/<id>/files): fs_* commands and the
                       # `media` scheme (files whole, by range, a part by `?part=a-b`; a recording by its id)
  native/asr.c         # whisper.cpp's C API for Rust: a model (on the GPU or not), an answer heard
                       # (greedy, temperature 0)
  build.rs             # on Android and iOS: asr.c compiled, whisper.cpp's static libraries linked
  tauri.conf.json      # app.sprachanker.mobile; the page from dist/
  capabilities/        # what the page may call
  icons/               # from apps/web/public/icon-512.png (`cargo tauri icon`)
  gen/android/         # the Android project Tauri generated, MainActivity's insets, microphone and
                       # Back added (its build outputs ignored); Native.kt (the page's bridge: files —
                       # small things at once —, requests to other hosts by HttpURLConnection, a file
                       # into Downloads by MediaStore), WorkService.kt (a foreground service while work
                       # goes on)
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
  `adb install -r -d src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
  (`-d`: the build number may be below the one there; never uninstall — it deletes the app's files).
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
  whole (blob URLs); it applies a Range header to the scheme's answer itself: parts are asked by
  `?part=`; a page's Request and Response carry no cookie: the session goes in a header; a page's
  Request drops Content-Length: a file sent sets it on the Headers boot.ts hands the server.
- The shared code's files go through the DataFs (phone-fs.ts), never the tree or Tauri commands
  (iOS only), so one view of the files is kept; its requests to other hosts through net.ts, the
  page's own `fetch` stays the WebView's.
- What the bridge answers at once blocks the page while it works: a call each for small things only;
  a large file is read by the scheme, written in 1 MB parts, summed later (`sums`).
- A file read or written whole through the bridge (`readBytes` without a length, `writeFile`, a
  profile's or an .apkg's database in sql.js) is held whole three times — Java's bytes, its string,
  the page's —: about 100–200 MB is the most (the app's Java heap); larger ones go by the stream.
- The WebView is the app's alone: lib.rs lets it navigate only to the app's own pages, the CSP
  (tauri.conf.json) lets in the app, the `media` scheme, blob:, data: pictures, WebAssembly and
  Tauri's IPC — no frame, no other host (the server's code reaches them through Native.kt) —, and
  Native.kt answers only while the app's own page is in the main frame (`guard`; a new bridge
  method calls it too). A new need (a host, a frame) goes into the CSP, checked on the phone.
- Android 11 (API 30) and later (`minSdk`, tauri.conf.json's `minSdkVersion`): no code for older ones.
- A link fails on the phone's storage (EPERM): what the storage links on a computer it copies here
  (a course's export: its JSON only — its media are streamed from where they are).

## Planned

- iOS: the bridge in Swift (files at once, requests, Downloads) — till then iOS has the course and
  practice offline only; on an iPhone whisper.cpp built for `iphoneos` (Metal), signing with an Apple ID.
- Sync with the Mac's server (`docs/decisions.md`).
