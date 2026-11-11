# Task: Native desktop app with an embedded browser pane

Status: not started (deferred)

## Goal

Show a PR's GitHub page (and a Jira issue's page) inside the PR Deck window, docked beside the side
panel, instead of in a separate browser window.

## Why it needs a native app

GitHub and Jira send `X-Frame-Options: deny` / `Content-Security-Policy: frame-ancestors 'none'`, so
their pages can't be shown in an `<iframe>`. The installed app is a PWA, which is still a web page, so
it has the same limit. Today the best it can do is "Open beside" (`web/src/composables/besideWindow.ts`):
a separate popup window on the right half of the screen that follows the selected PR.

A desktop shell with its own browser views is not bound by those headers.

## Approach

Wrap the existing app in **Electron**. Tauri is lighter (system WebKit), but multiple webviews in one
window are still behind an unstable flag in Tauri v2; Electron's `WebContentsView` is mature.

- **Main window** loads the existing web app from the local server (`http://127.0.0.1:4317`). The Vue
  app and the server stay as they are.
- **Embedded pane**: a `WebContentsView` attached to the main window that loads github.com /
  Atlassian URLs, positioned in a rect the web app reports.
- **Bridge**: a preload script exposes a small API to the web app (via `contextBridge`), e.g.
  `window.prdeckNative.showPage(url, bounds)`, `hidePage()`, `setBounds(bounds)`. The web app uses it
  when present and falls back to `openBeside()` otherwise (browser / PWA).
- **Session**: the pane uses a persistent partition (e.g. `persist:web`) so GitHub and Jira logins
  survive restarts. Users sign in once inside the app; it does not share the system browser's cookies.
- **Server**: the Electron main process starts the server on launch (same command the LaunchAgent uses:
  node + tsx `server/src/index.ts`, `NODE_ENV=production`) and stops it on quit, or detects an already
  running one on the port and reuses it.

## Scope

1. `desktop/` package: Electron main process, preload, build config (electron-builder or Forge) that
   produces a macOS `.app` / `.dmg`.
2. Main window loading the local app; window state (size, position) remembered.
3. Embedded pane: show/hide/resize from the web app; follows the selected PR (same trigger as
   `followBeside`); toolbar with back, reload and "open in browser".
4. Web app: detect the bridge; the "Open beside" button docks the pane instead of opening a popup;
   the side panel and the pane share the right-hand area (panel width + pane width, both resizable).
5. Links inside the pane that leave GitHub/Jira open in the system browser.
6. Docs: README section for the desktop app (build, install, sign-in, data location); note that the
   LaunchAgent (`npm run app:install`) isn't needed when using the desktop app.

## Acceptance criteria

- Clicking "Open beside" in the desktop app shows the PR's GitHub page docked inside the window,
  logged in, and it follows the selected PR (click or arrow keys).
- The same works for Jira issues from the Jira panel.
- Closing the pane, resizing it and resizing the window keep the layout correct.
- The browser/PWA version keeps working unchanged (popup "Open beside").
- No tokens or cookies leave the machine; the server still binds to `127.0.0.1` only.

## Open questions

- Code signing and notarization for distribution, or local unsigned builds only?
- Auto-update (electron-updater) or manual rebuilds?
- Should the pane also handle Slack permalinks (Slack's web client in the pane)?
- Keep the PWA as a supported way to run it, or make the desktop app the main one?

## Notes

- Size: Electron adds roughly 150 MB to the installed app.
- Security: keep `contextIsolation: true`, `nodeIntegration: false` in both the main window and the
  pane; the pane gets no preload/bridge. Only the main window may call the bridge.
- Relevant code today: `web/src/composables/besideWindow.ts`, `web/src/components/PrDrawer.vue`
  (Open beside button), `web/src/components/SidePanel.vue`, `scripts/app-install.sh` (server start
  command), `web/public/manifest.webmanifest`.
