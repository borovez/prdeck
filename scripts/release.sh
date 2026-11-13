#!/bin/sh
# Publishes a PR Deck release: bumps the version (patch, minor or major), tags it, pushes, and creates
# a GitHub Release with generated notes. Installed apps see it within a few hours (or on "Check for
# updates") and offer to update.   Usage: npm run release -- minor
set -eu

BUMP="${1:-patch}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

case "$BUMP" in patch|minor|major) ;; *) echo "Usage: npm run release -- patch|minor|major" >&2; exit 1 ;; esac
command -v gh >/dev/null || { echo "The GitHub CLI (gh) is needed to create the release." >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Release from main." >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit or stash your changes first." >&2; exit 1; }
git pull --ff-only

# npm version bumps package.json, commits "v<version>" and tags it
VERSION="$(npm version "$BUMP" -m "Release v%s")"
git push --follow-tags
gh release create "$VERSION" --title "PR Deck $VERSION" --generate-notes
echo "Released $VERSION"
