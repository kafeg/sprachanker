#!/usr/bin/env bash
# Builds the binary and restarts the owner's server from it: copies the binary and the speech
# engines into the install folder, stops the server on the port, starts the new one, waits for health.
# Usage: deploy.sh [--no-build]   Env: SPRACHANKER_HOME (default ~/SprachAnker), PORT (default 4580).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HOME_DIR="${SPRACHANKER_HOME:-$HOME/SprachAnker}"
PORT="${PORT:-4580}"
BIN="$HOME_DIR/bin"

if [[ "${1:-}" != "--no-build" ]]; then (cd "$ROOT" && bun run build:bin); fi
DIST="$ROOT/apps/cli/dist"
[[ -x "$DIST/sprachanker" ]] || { echo "no binary in $DIST: run bun run build:cli once"; exit 1; }

pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [[ -n "$pid" ]]; then
  kill "$pid"
  for _ in $(seq 1 40); do lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
fi
mkdir -p "$BIN"
cp "$DIST/sprachanker" "$BIN/"
cp "$DIST"/*-apple-darwin "$DIST"/*-linux-* "$BIN/" 2>/dev/null || true
cd "$BIN"
nohup ./sprachanker serve --data "$HOME_DIR" --host 0.0.0.0 --port "$PORT" >"$BIN/serve.log" 2>&1 &
for _ in $(seq 1 40); do
  if curl -fs "http://127.0.0.1:$PORT/api/health"; then echo; exit 0; fi
  sleep 0.5
done
echo "server did not answer; see $BIN/serve.log"; tail -20 "$BIN/serve.log"; exit 1
