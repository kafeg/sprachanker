---
name: release
description: "Cut a SprachAnker version for others: version bump, the binary and the speech engines built and tested, an archive published as a GitHub Release, the install checked on a clean folder. Use when asked to release, publish, tag or ship a version. Not for the owner's own server (deploy-local)."
---
# release
Publishes one version: the desktop app (a zip and a dmg) and an archive of the binary and the speech engines, tested, running without the repository.

## Rules
- Release only from `main`, with a clean tree, `bun run check` green and the full e2e green on the build being released.
- The archive holds the `sprachanker` binary, the speech engines and `THIRD_PARTY_NOTICES.txt` beside it — nothing else; the app holds the same build (the notices in `Contents/Resources`). Models, voices and courses download from the app.
- ⚠️ Never put course content, keys or personal data in an archive or a release note: the repository is public.
- The version is MAJOR.MINOR.N: MAJOR.MINOR in `apps/cli/package.json`, N the commit count of the build (`bun apps/cli/scripts/version.ts` prints it; the server reports it at `/api/health`). Change MAJOR.MINOR only for a large step.
- Build on the platform the archive is for: the speech engines are native (macOS arm64 only, the
  owner's decision 2026-10-12). They are built apart, each kept as a pre-release
  (`bun native/scripts/tag.ts <engine>` names it; `.github/workflows/engines.yml` builds a missing
  one); the Release workflow downloads them.

## Procedure
1. Read the current version and the changes since the last tag:
   ```bash
   bun apps/cli/scripts/version.ts && git describe --tags --abbrev=0 && git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
   ```
2. For a large step, set the new MAJOR.MINOR in `apps/cli/package.json`, commit, push `main`. The version to tag is what `bun apps/cli/scripts/version.ts` prints at the pushed HEAD.
3. Tag and push the tag. CI (`.github/workflows/release.yml`) builds the engines and the binary on
   `macos-15`, runs the e2e on that build, builds the desktop app on it and makes a draft release with
   the app's dmg and zip, the archive and `install.sh`:
   ```bash
   V=v$(bun apps/cli/scripts/version.ts) && git tag "$V" && git push origin "$V" && gh run watch "$(gh run list -w Release -L 1 --json databaseId -q '.[0].databaseId')"
   ```
4. Check the draft's archive on a clean folder, without the repository (`open` stubbed: no browser):
   ```bash
   gh release download vX.Y.Z -D /tmp/sa-rel && SPRACHANKER_ARCHIVE=/tmp/sa-rel/sprachanker-macos-arm64.tar.gz SPRACHANKER_HOME=/tmp/sa-home SPRACHANKER_PORT=4590 bash /tmp/sa-rel/install.sh
   ```
   Open it, download a course, finish a lesson step with speech recognition (its model downloaded in
   Settings). Then remove the test install as the README's Install says, and its folder. The app: open
   the draft's dmg, run `SprachAnker.app/Contents/MacOS/sprachanker-desktop` from it with
   `SPRACHANKER_HOME=/tmp/sa-app SPRACHANKER_PORT=4591` (another folder: the owner's server stays), see
   its window open the app, quit it from the tray.
5. Write the notes for learners — what is new, what changed in use; updating is the newer app over
   the old one, or the install command again; the app is not notarised: Privacy & Security → Open
   Anyway the first time; the third-party components and their licences: `THIRD_PARTY_NOTICES.txt`
   in the archive and the app, Settings → About in the app — and publish:
   ```bash
   gh release edit vX.Y.Z --notes-file <notes.md> --draft=false
   ```
6. Update the owner's own server: the newer app, the install command (installed by it) or `deploy-local`.

## Gotchas
- The build stops at the notices (`scripts/notices`) → an engine, Bun or a Gradle library moved without its inventory entry, or a crate lacks a licence text → update `scripts/notices/inventory.ts`; `bun run check` shows which.
- "cannot be opened" on another Mac → the file came through a browser (quarantine) → install with the `curl … | bash` command, or `xattr -dr com.apple.quarantine <folder>`.
- The release run fails at "Speech engines, from their releases" → an engine's release is missing (a new
  `VERSION` or `build.ts`) → wait for the Engines workflow (Actions → Engines), then run the release
  again: delete and push the tag again.
- The release run fails at "The tag is the binary's version" → the tag was not made from the computed version at its commit → delete the tag (`git push origin :vX.Y.N`), tag again with the version the script prints at that commit.
- The binary starts but speech is off → the engines are not beside the binary → unpack all files into one folder.
- A database newer than the binary → an older version started on newer data → never ship a downgrade over the same data folder.

## Boundaries
- The owner's own server: `deploy-local`.
- Platforms beyond macOS arm64, signing, the desktop app: `docs/plan.md`, "Releases".

<!-- style: ste80 -->
