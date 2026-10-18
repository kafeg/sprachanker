---
name: release
description: "Cut a SprachAnker version for others: version bump, the engines and every system's build made and tested by CI (macOS, Windows, Linux, Android), a draft GitHub Release checked and published — which every installed app then offers as its update. Use when asked to release, publish, tag or ship a version. Not for the owner's own server (deploy-local)."
---
# release
Publishes one version for every system: the desktop apps, the program's archives, the Android APK, the installer and latest.json, tested, running without the repository.

## Rules
- Release only from `main`, with a clean tree, `bun run check` green; CI runs the full e2e on each computer's build.
- ⚠️ Publishing is an update for everyone: each app reads the latest release (Settings → About; the desktop updater's latest.json). Check the draft before it is published.
- The assets: `SprachAnker-<v>-macos-arm64.{dmg,zip,app.tar.gz}`, `-windows-x64-setup.exe`, `-linux-x64.deb` (each update file with its `.sig`), `-android.apk`, `sprachanker-{macos-arm64,linux-x64}.tar.gz`, `sprachanker-windows-x64.zip`, `install.sh`, `latest.json`.
- An archive holds the `sprachanker` binary, the speech engines and `THIRD_PARTY_NOTICES.txt` — nothing else; the apps hold the same build. Models, voices and courses download from the app.
- ⚠️ Never put course content, keys or personal data in an asset or a release note: the repository is public.
- ⚠️ The signing keys live only in the owner's private secrets and the repository's Actions secrets: never in the repository, a log or a note. A lost updater key: installed desktop apps update no more (a new app by hand). A lost APK key: Android installs no newer APK over the app.
- The version is MAJOR.MINOR.N: MAJOR.MINOR in `apps/cli/package.json`, N the commit count of the build (`bun apps/cli/scripts/version.ts`; the server reports it at `/api/health`; Android's build number is N). Change MAJOR.MINOR only for a large step.
- The speech engines are built apart, a release each, a file per system (`bun native/scripts/tag.ts <engine>` names it; `.github/workflows/engines.yml` builds a missing one); the Release workflow downloads them.

## Once: the Actions secrets (the owner)
From the private secrets folder (`<secrets>`: the updater key, the APK keystore and their passwords):
```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R kafeg/sprachanker < <secrets>/tauri-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R kafeg/sprachanker < <secrets>/tauri-updater.password
base64 -i <secrets>/android-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 -R kafeg/sprachanker
gh secret set ANDROID_KEYSTORE_PASSWORD -R kafeg/sprachanker < <secrets>/android-release.password
```

## Procedure
1. Read the current version and the changes since the last tag:
   ```bash
   bun apps/cli/scripts/version.ts && git describe --tags --abbrev=0 && git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
   ```
2. For a large step, set the new MAJOR.MINOR in `apps/cli/package.json`, commit, push `main`. The version to tag is what `bun apps/cli/scripts/version.ts` prints at the pushed HEAD.
3. Each engine's release has its three files (else wait for Actions → Engines after the push):
   ```bash
   for e in whisper piper qwen; do gh release view "$(bun native/scripts/tag.ts $e | jq -r .tag)" --json assets -q '.assets[].name'; done
   ```
4. Tag and push the tag; CI (`.github/workflows/release.yml`) builds and tests each system and makes the draft:
   ```bash
   V=v$(bun apps/cli/scripts/version.ts) && git tag "$V" && git push origin "$V" && gh run watch "$(gh run list -w Release -L 1 --json databaseId -q '.[0].databaseId')"
   ```
5. Check the draft: every asset above is there; `latest.json` names this version and a file with a signature for `darwin-aarch64`, `windows-x86_64`, `linux-x86_64`.
   - The Mac archive on a clean folder, without the repository (`open` stubbed: no browser):
     ```bash
     gh release download vX.Y.Z -D /tmp/sa-rel && SPRACHANKER_ARCHIVE=/tmp/sa-rel/sprachanker-macos-arm64.tar.gz SPRACHANKER_HOME=/tmp/sa-home SPRACHANKER_PORT=4590 bash /tmp/sa-rel/install.sh
     ```
     Open it, download a course, finish a lesson step with speech recognition (its model downloaded in Settings). Then remove the test install as the README says, and its folder.
   - The Mac app: run `SprachAnker.app/Contents/MacOS/sprachanker-desktop` from the dmg with `SPRACHANKER_HOME=/tmp/sa-app SPRACHANKER_PORT=4591` (another folder: the owner's server stays); its window opens the app; quit it from the tray.
   - Windows and Linux: in a VM (the owner's lab — VMs started and stopped as its scripts do), the installer or `apt install ./….deb`; the app opens, a lesson plays, speech recognition with a downloaded model.
   - Android: `adb install -r` of the APK over the app of the previous release — never uninstall (it deletes the app's files).
6. Write the notes for learners — what is new, what changed in use; how to update: the app itself (Settings → About), the install command again, a new archive on Windows; not signed by Apple or Microsoft: the first time Privacy & Security → Open Anyway (macOS) or More info → Run anyway (Windows); the third-party components and their licences: `THIRD_PARTY_NOTICES.txt`, Settings → About — and publish:
   ```bash
   gh release edit vX.Y.Z --notes-file <notes.md> --draft=false
   ```
7. Update the owner's own server: the app itself, the install command (installed by it) or `deploy-local`.

## Trying a build on the lab's VMs (before a tag)
The lab's Windows 10 VM `ghr-win10` and Debian 11 VM `ghr-deb11` are the owner's work build machines: one VM at a time, started and shut down through the Proxmox API, reached over SSH (how, and the keys: the owner's private lab notes). Toolchains in the user's profile; the checkout stays for the next run:
- `ghr-win10`: `~\sprachanker` (Bun in `~\.bun`, Rust in `~\.cargo`; Visual Studio 2022 and CMake are the VM's own); its log `~\sprachanker-build.log`.
  ⚠️ Speech (Whisper, Qwen) needs AVX2: its CPU type is `x86-64-v2-AES` (none) — for a speech test set it to `x86-64-v3`, then restart Windows from inside (`shutdown /r`: Fast Startup keeps the old CPU state through an API shutdown or reboot); set it back after, shutting down from inside (`shutdown /s`).
  ```powershell
  $env:PATH="$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"; cd ~\sprachanker
  git fetch <bundle or origin> <branch>; git checkout -B <branch> FETCH_HEAD
  bun install; bun native/scripts/build.ts; $env:E2E_ALL='1'; bun run e2e; bun run --filter @sprachanker/desktop build
  ```
  Then the installer from `apps/desktop/dist` with `/S` (for the user, no administrator), the app started in the desktop session (a scheduled task with `/IT`: SSH has no screen).
- `ghr-deb11`: the release runner's Ubuntu 22.04 in Docker (Debian 11 has no WebKitGTK 4.1): `~/sprachanker` mounted into the image `sprachanker-build:22.04` (`~/sprachanker-env/Dockerfile`: Bun, Rust, WebKitGTK, Xvfb), caches in `~/.cache/sprachanker-docker`; `~/sprachanker-env/build.sh` runs the same steps.
- Not the runners: the Windows VM's Visual Studio 17.12 cannot link sherpa-onnx's prebuilt ONNX Runtime (the runner's 17.14 can), so Piper there is sherpa-onnx's own Windows build; its CPU type has no AVX2, so the x64 engines stop at their first model — speech is tried where the CPU has AVX2.

## Gotchas
- The build stops at the notices (`scripts/notices`) → an engine, Bun, a crate or a Gradle library moved without its inventory entry → update `scripts/notices/inventory.ts` (Bun: `bun scripts/notices/bun.ts`); `bun run check` shows which.
- "publish" fails at latest.ts "has no signature" → `TAURI_SIGNING_PRIVATE_KEY` (or its password) is not set → set the secrets, run the release again.
- The Android job fails "no ANDROID_KEYSTORE_BASE64" → the secrets → the same.
- A run fails at "Speech engines, from their releases" → an engine's file for that system is missing (a new `VERSION` or `build.ts`) → wait for the Engines workflow, then delete and push the tag again.
- A run fails at "The tag is the binary's version" → the tag was not made from the computed version at its commit → delete the tag (`git push origin :vX.Y.N`), tag again with the version the script prints at that commit.
- The first release-signed APK does not install over a hand-built one (another key) → move the courses and profiles off the phone first (a profile file, course files), then uninstall and install.
- "cannot be opened" on another Mac → the file came through a browser (quarantine) → Open Anyway, or `xattr -dr com.apple.quarantine <folder>`; updates from the app itself are not quarantined.
- The binary starts but speech is off → the engines are not beside the binary → unpack all files into one folder.
- A database newer than the binary → an older version started on newer data → never ship a downgrade over the same data folder (the apps refuse older versions).

## Boundaries
- The owner's own server: `deploy-local`.
- What is not built yet (AppImage, arm64 PCs, code signing): `docs/plan.md`, "Releases".

<!-- style: ste80 -->
