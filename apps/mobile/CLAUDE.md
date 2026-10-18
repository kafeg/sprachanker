# apps/mobile

The phone app (Tauri 2): the web app with the server's code running in its WebView over the phone's
own files, Whisper in the app's process, reading aloud's engines run as programs. It stands alone
(docs/decisions.md): the same code as the computer's — the server's storage
(`packages/server/src/storage/`), the importers, the web UI — over the phone's adapters: files
(course-kit's DataFs), requests to other hosts, SQLite (sql.js), zstd.
What comes next: `docs/plan.md`, "Phone app".

## Layout

```
src/                   # runs in the WebView, before the web app (bundled into dist/boot.js)
  boot.ts              # createApp over the phone's adapters and the server's storage (Android); the web
                       # app's /api requests answered in the page (the session in a header); files in and
                       # out (`sprachankerTransfer`: sent as read, an export into Downloads); work kept
                       # going while the app is put away (`work`); media and recordings from the native
                       # scheme (`sprachankerFileUrl`), films whole as blob URLs (`sprachankerPlayable`);
                       # the listener started before createApp (its port: listensOn, `network.ts`)
  host.ts              # other devices' requests answered by the same server (headers whole, the body
                       # pulled, the answer in parts, its cookie from COOKIE_HEADER); `NativeFile`: a
                       # random token the native side sends as the file (media, recordings, web files)
  network.ts           # the server's NetworkHost: Wi-Fi's, a hotspot's, Tailscale's addresses (bridge)
  bridge.ts            # the native bridge (Native.kt): its methods, bytes as Latin-1, later answers
  phone-fs.ts          # course-kit's DataFs over the bridge: folders' entries kept, a change noting its
                       # own entry; parts read by the scheme's `?part=`, small files at once
  net.ts               # `fetch` by the native side (no CORS): the server's code only, never the page's
  sql.ts               # sql.js for the storage: an .apkg's database (zstd by fzstd), a profile file's
                       # copied, opened, made ready (the server's profile-db.ts)
  native.ts            # the native side's Tauri commands: files (listed, read through
                       # http://media.localhost, written, removed: iOS), Whisper, the engines
  files.ts             # the app's files as the server's ProfileFiles and the databases see them: over
                       # the DataFs (Android, `filesOver`), or a tree kept in memory (iOS)
  db.ts                # sql.js databases: read, migrated (the server's migrate.ts), written back after
                       # changes; nested transactions as savepoints
  profiles.ts          # the server's ProfileFiles: profile databases, recordings
  speech.ts            # the server's SpeechHost: Whisper in the app answering as whisper-server;
                       # Qwen3-TTS's tts-server a program on a 127.0.0.1 port, asked through the
                       # native side; a phone's defaults (the small models)
  piper.ts             # the server's PiperHost: sherpa-onnx's program run per text, its voices
                       # downloaded by the server's storage, unpacked by the native side
  voices.ts            # Android's TextToSpeech (Voices.kt) as the page's speechSynthesis (device voices)
scripts/
  build.ts             # dist/: the web app's build, boot.js before it, sql.js's wasm, whisper.html;
                       # THIRD_PARTY_NOTICES.txt (scripts/notices) there and in the Android assets
  dev.ts               # dist/ on this Mac with the native side played over a folder (a browser test)
  phone.ts             # the phone looked after over adb: install (build + adb install), course (a
                       # course of this Mac's library pushed), practice (its AI practice brought up
                       # to date), models (Whisper's q8_0), page (an expression in the app's WebView)
www/                   # the Whisper test page (dist/whisper.html; www/phrases: made by
                       # e2e/speech/phrases.ts, not committed)
src-tauri/
  src/lib.rs           # commands `load` (a model) and `transcribe` (16 kHz f32 samples)
  src/engines.rs       # reading aloud's engines (libsa_piper.so, libsa_qwen.so) run as processes:
                       # started, awaited, stopped; a request to one on 127.0.0.1; a .tar.bz2 unpacked
  src/host.rs          # the listener (hyper; 4580, another kept in host.json; nearby networks only):
                       # heads to the page by a Channel, bodies read ahead, pulled by `/.host/<id>`,
                       # answers' bodies by `host_write` (base64); files (library, decks, recordings)
  src/files.rs         # the data root (Android: /sdcard/Android/data/<id>/files): fs_* commands and the
                       # `media` scheme (files whole, by range, a part by `?part=a-b`; a recording by its id)
  native/asr.c         # whisper.cpp's C API for Rust: a model (GPU or not), an answer heard (greedy)
  build.rs             # on Android and iOS: asr.c compiled, whisper.cpp's static libraries linked;
                       # on Android the engines built in native/ packed into jniLibs as libsa_<engine>.so
  tauri.conf.json      # app.sprachanker.mobile; the page from dist/ (capabilities/: what it may call)
  icons/               # from apps/web/public/icon-512.png (`cargo tauri icon`)
  gen/android/         # the Android project Tauri generated, MainActivity's insets, microphone and
                       # Back added (its build outputs ignored); Native.kt (the page's bridge: files —
                       # small things at once —, requests to other hosts by HttpURLConnection, a file
                       # into Downloads by MediaStore), WorkService.kt (a foreground service while work
                       # goes on or the app is open to others; its Close ends the app), Voices.kt
                       # (TextToSpeech for the page: installed voices only)
  gen/apple/           # the iOS project Tauri generated (`cargo tauri ios init`; xcodegen, CocoaPods)
```

## Build and run (Android)

- Once: Rust with the Android targets, the NDK, `cargo install tauri-cli` (2.x), whisper.cpp built for the
  phone by `bun run speech:android` (the server's version, `native/whisper/VERSION`); Piper's and Qwen3-TTS's
  programs for the phone — `bun native/scripts/build.ts android` (`phone.ts install` builds them once).
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
- The debug build's WebView: Chrome's DevTools after `adb forward tcp:9334 localabstract:webview_devtools_remote_<pid>`.
- An engine timed over adb: with the screen on — off, the phone sleeps between packets (a reading took minutes).

## Build and run (iOS simulator)

- `bun scripts/build.ts`, `cargo tauri ios build --debug --target aarch64-sim`, then
  `xcrun simctl install <device> src-tauri/gen/apple/build/arm64-sim/SprachAnker.app` and
  `xcrun simctl launch <device> app.sprachanker.mobile`.
- The data root is the app's Documents (`xcrun simctl get_app_container <device> <id> data`).
- iOS names the schemes, not hosts: the page is `tauri://localhost`, the files `media://localhost`.
- Its WKWebView: `ios_webkit_debug_proxy -s unix:<the simulator's webinspectord_sim.socket>`.
- Whisper for iOS: whisper.cpp's static libraries with Metal (and Accelerate), built from the same
  sources into `build-ios-sim` (`-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=OFF`;
  `build-ios` for a device: `iphoneos`); the model in Documents/models. The simulator's Metal cannot
  hold a model: there it runs on the CPU (`target_abi = "sim"`).

## Rules

- whisper.cpp is the server's version, linked through `src-tauri/native/asr.c`: no second copy of Whisper
  (whisper-rs bundles its own, and its build links macOS's libraries when cross-compiled from a Mac).
- Keep the Rust small: what needs the platform (Whisper, files, the microphone's permission, running
  the engines); the app itself is the web app and the server's code in the WebView.
- Reading aloud's engines are the computer's programs built for the phone and run as the server runs
  them there (the same services, the phone's SpeechHost and PiperHost): Android runs programs only
  from the app's native library folder, so they are packed as `lib*.so` and installed unpacked
  (`useLegacyPackaging`). A crash ends their process alone, but they keep the app's standing with the
  memory killer (an app may not change it): the page stops them a minute after the app is put away
  while none is asked anything; on a phone one Qwen3-TTS model at a time.
- The device's voices: only those installed on the phone are offered or used — a language set
  without one is read by Google's server, which would send the text away.
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
- Android 11 (API 30) and later (`minSdk`, tauri.conf.json's `minSdkVersion`): no older code.
- Open to other devices (Android): files the native side sends (`NativeFile`), the rest is the
  server's answer in the page — no route, check or cookie of its own here; a foreground service
  (`desktop.hosting`) keeps it alive. The WebView's scheme serves one request at a time: no long wait.
- A link fails on the phone's storage (EPERM): what the storage links on a computer it copies here
  (a course's export: its JSON only — its media are streamed from where they are).

## Planned

- iOS: the bridge in Swift (files at once, requests, Downloads) — till then iOS has the course and
  practice offline only; on an iPhone whisper.cpp built for `iphoneos` (Metal), signing with an Apple ID.
- Sync with the Mac's server (`docs/decisions.md`). iOS open to other devices (no listener there yet).
