#!/bin/bash
# Installs SprachAnker on a Mac with Apple Silicon, or updates it: the latest release (or
# SPRACHANKER_VERSION, e.g. v0.2.0) into ~/SprachAnker/bin, the data beside it in ~/SprachAnker, kept
# running by a LaunchAgent (started at login, restarted if it stops), then opened in the browser.
# Before an update the data is backed up into ~/SprachAnker-backups. Published with each release:
#   curl -fsSL https://github.com/kafeg/sprachanker/releases/latest/download/install.sh | bash
# Env: SPRACHANKER_HOME (~/SprachAnker), SPRACHANKER_PORT (4580), SPRACHANKER_HOST (127.0.0.1;
# 0.0.0.0 for phones on the local network), SPRACHANKER_ARCHIVE (an archive on disk instead of the
# download: a build checked before it is published).
set -euo pipefail

REPO="kafeg/sprachanker"
ASSET="sprachanker-macos-arm64.tar.gz"
HOME_DIR="${SPRACHANKER_HOME:-$HOME/SprachAnker}"
PORT="${SPRACHANKER_PORT:-4580}"
HOST="${SPRACHANKER_HOST:-127.0.0.1}"
BIN="$HOME_DIR/bin"
LABEL="app.sprachanker.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "SprachAnker runs on Macs with Apple Silicon (M1 and later) only, for now." >&2
  exit 1
fi

if [[ -n "${SPRACHANKER_VERSION:-}" ]]; then
  URL="https://github.com/$REPO/releases/download/$SPRACHANKER_VERSION/$ASSET"
else
  URL="https://github.com/$REPO/releases/latest/download/$ASSET"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [[ -n "${SPRACHANKER_ARCHIVE:-}" ]]; then
  cp "$SPRACHANKER_ARCHIVE" "$tmp/$ASSET"
else
  echo "Downloading SprachAnker…"
  curl -fL --progress-bar "$URL" -o "$tmp/$ASSET"
fi
mkdir "$tmp/new"
tar -xzf "$tmp/$ASSET" -C "$tmp/new"
new="$("$tmp/new/sprachanker" version)"

old=""
[[ -x "$BIN/sprachanker" ]] && old="$("$BIN/sprachanker" version 2>/dev/null || true)"

# The server stopped: ours by its LaunchAgent, one started by hand on the port if it is SprachAnker.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [[ -n "$pid" ]]; then
  if ps -p "$pid" -o comm= | grep -q sprachanker; then
    kill "$pid"
  else
    echo "Port $PORT is taken by another program: run again with SPRACHANKER_PORT=<another port>." >&2
    exit 1
  fi
fi
for _ in $(seq 1 40); do lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null || break; sleep 0.5; done

# An update: what cannot be downloaded again copied first (the version before it can open it).
if [[ -n "$old" && "$old" != "$new" && -f "$HOME_DIR/server.sqlite" ]]; then
  echo "Backing up your data (version $old)…"
  mkdir -p "$HOME_DIR-backups"
  "$BIN/sprachanker" backup --data "$HOME_DIR" --to "$HOME_DIR-backups"
fi

mkdir -p "$BIN" "$(dirname "$PLIST")"
rm -f "$BIN"/sprachanker "$BIN"/*-apple-darwin
cp "$tmp/new"/* "$BIN/"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN/sprachanker</string>
    <string>serve</string>
    <string>--data</string><string>$HOME_DIR</string>
    <string>--host</string><string>$HOST</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$BIN</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BIN/serve.log</string>
  <key>StandardErrorPath</key><string>$BIN/serve.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "$DOMAIN" "$PLIST"

address="http://127.0.0.1:$PORT"
for _ in $(seq 1 60); do
  if curl -fs "$address/api/health" >/dev/null; then
    echo "SprachAnker $new is running: $address"
    echo "  program: $BIN   data: $HOME_DIR"
    echo "  starts at login; to update, run this command again"
    open "$address"
    exit 0
  fi
  sleep 0.5
done
echo "SprachAnker did not start; see $BIN/serve.log" >&2
tail -20 "$BIN/serve.log" >&2
exit 1
