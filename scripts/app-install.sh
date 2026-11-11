#!/bin/sh
# Builds PR Deck and runs its server in the background at login (a macOS LaunchAgent), so the app
# installed from the browser always has a server to talk to. Safe to re-run: it rebuilds and restarts.
set -eu

LABEL="prdeck.server"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/PRDeck.log"
PORT="${PRDECK_PORT:-4317}"
NODE="$(command -v node || true)"
TSX="$REPO/node_modules/tsx/dist/cli.mjs"

[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS." >&2; exit 1; }
[ -n "$NODE" ] || { echo "node not found on PATH (Node 24, see .nvmrc)." >&2; exit 1; }
[ -f "$TSX" ] || { echo "Dependencies missing: run npm install first." >&2; exit 1; }

# Our own service is fine (we restart it); anything else on the port is not
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Port $PORT is in use (is \`npm run dev\` running?). Stop it, or set PRDECK_PORT." >&2
  exit 1
fi

echo "Building the web app…"
(cd "$REPO" && npm run build --silent)

# launchd starts programs with a bare PATH: include node, the Claude Code CLI and Homebrew (gh)
SERVICE_PATH="$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$TSX</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PRDECK_PORT</key><string>$PORT</string>
    <key>PATH</key><string>$SERVICE_PATH</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

URL="http://127.0.0.1:$PORT"
printf 'Waiting for the server'
for _ in $(seq 1 30); do
  if curl -fs "$URL/api/health" >/dev/null 2>&1; then
    printf '\nPR Deck is running at %s (starts at login; logs: %s)\n\n' "$URL" "$LOG"
    echo "Install it as an app:"
    echo "  Chrome / Edge / Arc: open $URL, then the install icon in the address bar (or menu > Cast, save and share > Install page as app)"
    echo "  Safari: open $URL, then File > Add to Dock"
    exit 0
  fi
  printf '.'
  sleep 1
done
printf '\nThe server did not answer on %s. Check %s\n' "$URL" "$LOG" >&2
exit 1
