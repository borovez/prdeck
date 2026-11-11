#!/bin/sh
# Stops the PR Deck background server and removes it from login items. Your data (~/.prdeck) stays.
set -eu
LABEL="prdeck.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "PR Deck's background server is stopped and won't start at login."
echo "Remove the installed app like any other app (Launchpad, or the app's own menu > Uninstall)."
