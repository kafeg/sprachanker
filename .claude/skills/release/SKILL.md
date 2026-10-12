---
name: release
description: "Cut a SprachAnker version for others: version bump, the binary and the speech engines built and tested, an archive published as a GitHub Release, the install checked on a clean folder. Use when asked to release, publish, tag or ship a version. Not for the owner's own server (deploy-local)."
---
# release
Publishes one version: a tested archive of the binary and the speech engines that runs without the repository.

## Rules
- Release only from `main`, with a clean tree, `bun run check` green and the full e2e green on the build being released.
- The archive holds the `sprachanker` binary and the speech engines beside it — nothing else. Models, voices and courses download from the app.
- ⚠️ Never put course content, keys or personal data in an archive or a release note: the repository is public.
- Versions follow semver; the version lives in `apps/cli/package.json` (the server reports it at `/api/health`).
- Build on the platform the archive is for: the speech engines are native (today macOS arm64 only).

## Procedure
1. Read the current version and the changes since the last tag:
   ```bash
   jq -r .version apps/cli/package.json && git describe --tags --abbrev=0 && git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
   ```
2. Set the new version in `apps/cli/package.json`. Commit it as `release: vX.Y.Z`.
3. Build everything from scratch and test the build:
   ```bash
   bun install --frozen-lockfile && bun run build:cli && bun run e2e
   ```
4. Pack the archive (one per platform):
   ```bash
   cd apps/cli/dist && tar -czf "../sprachanker-vX.Y.Z-macos-arm64.tar.gz" sprachanker *-apple-darwin
   ```
5. Check it on a clean folder, without the repository: unpack into a temporary folder, run `./sprachanker serve --data <tmp>/data --port 4590`, open it, download a course, finish a lesson step with speech recognition (its model downloaded in Settings).
6. Tag and publish:
   ```bash
   git tag vX.Y.Z && git push origin main vX.Y.Z
   gh release create vX.Y.Z apps/cli/sprachanker-vX.Y.Z-macos-arm64.tar.gz --title vX.Y.Z --notes-file <notes.md>
   ```
   Write the notes for learners: what is new, what changed in use, how to update (replace the files, restart).
7. Deploy the same build to the owner's server: `deploy-local` with `--no-build`.

## Gotchas
- "cannot be opened" on another Mac → the file came through a browser (quarantine) → install with `curl` + `tar`, or `xattr -dr com.apple.quarantine <folder>`.
- The binary starts but speech is off → the engines are not beside the binary → unpack all files into one folder.
- A database newer than the binary → an older version started on newer data → never ship a downgrade over the same data folder.

## Boundaries
- The owner's own server: `deploy-local`.
- Automating this in CI and an install script: `docs/plan.md`, "Releases".

<!-- style: ste80 -->
