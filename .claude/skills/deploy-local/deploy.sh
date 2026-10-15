#!/usr/bin/env bash
# Builds the binary and restarts the owner's server from it, waits for health. The desktop app in
# /Applications: the app built around the binary, quit, replaced, opened (it runs the server). Else the
# installer's LaunchAgent, else a server by hand: the binary and the speech engines copied into the
# install folder, the server on the port restarted.
# Usage: deploy.sh [--no-build]   Env: SPRACHANKER_HOME (default ~/SprachAnker), PORT (default 4580).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HOME_DIR="${SPRACHANKER_HOME:-$HOME/SprachAnker}"
PORT="${PORT:-4580}"
BIN="$HOME_DIR/bin"

if [[ "${1:-}" != "--no-build" ]]; then (cd "$ROOT" && bun run build:bin); fi
DIST="$ROOT/apps/cli/dist"
[[ -x "$DIST/sprachanker" ]] || { echo "no binary in $DIST: run bun run build:cli once"; exit 1; }

healthy() {
  for _ in $(seq 1 60); do
    if curl -fs "http://127.0.0.1:$PORT/api/health"; then echo; return 0; fi
    sleep 0.5
  done
  return 1
}

# The desktop app runs the server: the new app in its place, started again.
APP="/Applications/SprachAnker.app"
if [[ -d "$APP" ]]; then
  (cd "$ROOT" && bun run --filter @sprachanker/desktop build)
  osascript -e 'tell application id "app.sprachanker.desktop" to quit' 2>/dev/null || true
  for _ in $(seq 1 40); do pgrep -f "$APP/Contents/MacOS/sprachanker-desktop" >/dev/null || break; sleep 0.5; done
  if pgrep -f "$APP/Contents/MacOS/sprachanker-desktop" >/dev/null; then
    echo "the app did not quit: quit SprachAnker (its menu bar icon → Quit) and run again"; exit 1
  fi
  rm -rf "$APP"
  ditto "$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/SprachAnker.app" "$APP"
  open "$APP"
  healthy || { echo "server did not answer; see ~/Library/Logs/SprachAnker/serve.log"; exit 1; }
  exit 0
fi

# Installed by apps/cli/install.sh: its LaunchAgent restarts the server from the new files.
PLIST="$HOME/Library/LaunchAgents/app.sprachanker.server.plist"
if [[ -f "$PLIST" ]]; then
  cp "$DIST/sprachanker" "$DIST"/*-apple-darwin "$BIN/"
  launchctl kickstart -k "gui/$(id -u)/app.sprachanker.server"
  for _ in $(seq 1 40); do
    if curl -fs "http://127.0.0.1:$PORT/api/health"; then echo; exit 0; fi
    sleep 0.5
  done
  echo "server did not answer; see $BIN/serve.log"; exit 1
fi

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
