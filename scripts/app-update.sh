#!/bin/sh
# Updates a PR Deck installed from source: pulls the latest code, installs dependencies, rebuilds the
# web app and restarts the background server. Run by the app's "Update and restart" button (output in
# ~/Library/Logs/PRDeck-update.log), or by hand with `npm run app:update`.
set -eu

LABEL="prdeck.server"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "== $(date '+%Y-%m-%d %H:%M:%S') updating PR Deck in $REPO"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Not updating: this checkout has local changes. Commit or stash them, then update." >&2
  exit 2
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch --tags origin
git pull --ff-only origin "$BRANCH"
npm install --no-audit --no-fund
npm run build --silent

# The background service picks up the new code on restart; a dev server reloads by itself
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Restarting the background server…"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
fi
echo "== updated to $(node -p "require('./package.json').version") ($(git rev-parse --short HEAD))"
