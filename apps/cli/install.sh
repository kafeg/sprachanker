#!/bin/bash
# Installs SprachAnker on a Mac with Apple Silicon or a Linux PC (x64), or updates it: the latest
# release (or SPRACHANKER_VERSION, e.g. v0.2.0) into ~/SprachAnker/bin, the data beside it in
# ~/SprachAnker, kept running — started at login, restarted if it stops — by a LaunchAgent (macOS) or
# a systemd user unit (Linux), then opened in the browser. Before an update the data is backed up into
# ~/SprachAnker-backups. Run again, it updates what it installed with the same folder, port and
# address. Published with each release:
#   curl -fsSL https://github.com/kafeg/sprachanker/releases/latest/download/install.sh | bash
# Env: SPRACHANKER_HOME (~/SprachAnker), SPRACHANKER_PORT (4580), SPRACHANKER_HOST (127.0.0.1;
# 0.0.0.0 for phones on the local network), SPRACHANKER_ARCHIVE (an archive on disk instead of the
# download: a build checked before it is published).
set -euo pipefail

REPO="kafeg/sprachanker"
SYSTEM="$(uname -s)"
case "$SYSTEM/$(uname -m)" in
  Darwin/arm64) ASSET="sprachanker-macos-arm64.tar.gz" ;;
  Linux/x86_64) ASSET="sprachanker-linux-x64.tar.gz" ;;
  *)
    echo "This installer is for Macs with Apple Silicon and Linux PCs (x64); on Windows, take the app or the archive from the release." >&2
    exit 1
    ;;
esac
LABEL="app.sprachanker.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT="sprachanker.service"
UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"

# What an earlier install set — its folder, port and address — unless told otherwise.
argument() {
  local flag=$1
  if [[ $SYSTEM == Darwin && -f "$PLIST" ]]; then
    tr -d '\n' <"$PLIST" | sed -n "s|.*<string>$flag</string> *<string>\([^<]*\)</string>.*|\1|p"
  elif [[ $SYSTEM == Linux && -f "$UNIT_FILE" ]]; then
    sed -n "s|^ExecStart=.* $flag \"\{0,1\}\([^\" ]*\)\"\{0,1\}.*|\1|p" "$UNIT_FILE"
  fi
}
HOME_DIR="${SPRACHANKER_HOME:-$(argument --data)}"
HOME_DIR="${HOME_DIR:-$HOME/SprachAnker}"
PORT="${SPRACHANKER_PORT:-$(argument --port)}"
PORT="${PORT:-4580}"
HOST="${SPRACHANKER_HOST:-$(argument --host)}"
HOST="${HOST:-127.0.0.1}"
BIN="$HOME_DIR/bin"

# The desktop app runs the server itself: the two would fight over the port and the data folder.
if [[ -d /Applications/SprachAnker.app || -d "$HOME/Applications/SprachAnker.app" ||
  -f "$HOME/Library/LaunchAgents/SprachAnker.plist" || -f "$HOME/.config/autostart/SprachAnker.desktop" ||
  -x /usr/bin/sprachanker-desktop ]]; then
  echo "The SprachAnker app is installed and runs the server: it updates itself (Settings → About)." >&2
  echo "To use this installer, quit the app and remove it first." >&2
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

# Whether something listens on the port, and waiting for it to let the port go.
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }
free() { for _ in $(seq 1 40); do listening || return 0; sleep 0.5; done; return 1; }

# The server stopped: ours by its service (it lets the port go a moment later); on a Mac one started by
# hand on the port if it is SprachAnker.
if [[ $SYSTEM == Darwin ]]; then
  DOMAIN="gui/$(id -u)"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && free || true
  pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [[ -n "$pid" ]] && ps -p "$pid" -o command= | grep -q sprachanker; then
    kill "$pid"
    free
  fi
else
  systemctl --user stop "$UNIT" 2>/dev/null && free || true
fi
if listening; then
  echo "Port $PORT is taken by another program: run again with SPRACHANKER_PORT=<another port>." >&2
  exit 1
fi

# An update: what cannot be downloaded again copied first (the version before it can open it).
if [[ -n "$old" && "$old" != "$new" && -f "$HOME_DIR/server.sqlite" ]]; then
  echo "Backing up your data (version $old)…"
  mkdir -p "$HOME_DIR-backups"
  "$BIN/sprachanker" backup --data "$HOME_DIR" --to "$HOME_DIR-backups"
fi

mkdir -p "$BIN"
rm -f "$BIN"/sprachanker "$BIN"/*-apple-darwin "$BIN"/*-linux-gnu
cp "$tmp/new"/* "$BIN/"

if [[ $SYSTEM == Darwin ]]; then
  mkdir -p "$(dirname "$PLIST")"
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
elif command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat >"$UNIT_FILE" <<UNIT
[Unit]
Description=SprachAnker

[Service]
ExecStart="$BIN/sprachanker" serve --data "$HOME_DIR" --host $HOST --port $PORT
WorkingDirectory=$BIN
Restart=always
RestartSec=2
StandardOutput=append:$BIN/serve.log
StandardError=append:$BIN/serve.log

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT" >/dev/null
else
  echo "No systemd for this user: start it yourself with" >&2
  echo "  \"$BIN/sprachanker\" serve --data \"$HOME_DIR\" --host $HOST --port $PORT" >&2
  exit 1
fi

address="http://127.0.0.1:$PORT"
for _ in $(seq 1 60); do
  if curl -fs "$address/api/health" >/dev/null; then
    echo "SprachAnker $new is running: $address"
    echo "  program: $BIN   data: $HOME_DIR"
    echo "  starts at login; to update, run this command again"
    if [[ $SYSTEM == Darwin ]]; then
      open "$address"
    elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null; then
      xdg-open "$address" >/dev/null 2>&1 || true
    fi
    exit 0
  fi
  sleep 0.5
done
echo "SprachAnker did not start; see $BIN/serve.log" >&2
tail -20 "$BIN/serve.log" >&2
exit 1
