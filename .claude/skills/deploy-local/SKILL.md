---
name: deploy-local
description: "Rebuild the binary and restart the owner's own server (~/SprachAnker/bin, port 4580) with the current code. Use when asked to restart, redeploy or update 'my server', 'the server on 4580', or to try a change in the real app. Not a release (see release) and not a dev server (bun run dev)."
---
# deploy-local
Puts the current code into the owner's running app: build, copy, restart, health check.

## Rules
- Run it only after `bun run check` is green; after a phase, also after `bun run e2e` (it builds the binary anyway).
- The data folder is `~/SprachAnker` (the owner's real data). Never point a test or a walk at it: use an APFS clone.
- The server listens on all addresses (`--host 0.0.0.0`): phones reach it over the network and Tailscale.

## Procedure
1. Deploy (builds the web app and the binary first):
   ```bash
   .claude/skills/deploy-local/deploy.sh
   ```
   If `bun run e2e` or `bun run build:bin` just ran, skip the build:
   ```bash
   .claude/skills/deploy-local/deploy.sh --no-build
   ```
2. Read the output: the last line is `{"status":"ok","version":…}`.
3. Report the commit deployed (`git log --oneline -1`).

## Gotchas
- "no binary in apps/cli/dist" → the speech engines were never built → run `bun run build:cli` once.
- Health never answers → read `~/SprachAnker/bin/serve.log` (a port taken by another process, a database newer than the binary).
- Port or folder differ → set `PORT` or `SPRACHANKER_HOME` before the script.

## Boundaries
- A version for others: `release`.
- Checking AI practice with a real model: `ai-practice-check` (its own server and data clone).

<!-- style: ste80 -->
