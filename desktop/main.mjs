// PR Deck for Mac: starts the bundled server (or reuses one already running, e.g. the background
// service from `npm run app:install`), opens the app in a window, and checks GitHub for new releases.
import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, shell, systemPreferences } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PRDECK_PORT ?? 4317)
const BASE = `http://127.0.0.1:${PORT}`
const REPO = 'borovez/prdeck'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const LOG = join(homedir(), 'Library', 'Logs', 'PRDeck-desktop.log')

let server = null
let window = null

// ---------- Lock: Touch ID (or the Mac password) before the app shows anything ----------

const PREFS = join(app.getPath('userData'), 'prefs.json')
const prefs = (() => {
  try {
    return { requireUnlock: true, ...JSON.parse(readFileSync(PREFS, 'utf8')) }
  } catch {
    return { requireUnlock: true }
  }
})()
const savePrefs = () => writeFileSync(PREFS, JSON.stringify(prefs, null, 2))
let locked = prefs.requireUnlock

/** Touch ID where the Mac has it, else the standard macOS password prompt */
async function authenticate() {
  if (systemPreferences.canPromptTouchID()) {
    try {
      await systemPreferences.promptTouchID('unlock PR Deck')
      return { ok: true }
    } catch (e) {
      // Cancelled or too many tries: offer the password instead of giving up
      if (!/cancel/i.test(String(e?.message))) return passwordPrompt()
      return { ok: false, message: 'Cancelled' }
    }
  }
  return passwordPrompt()
}
function passwordPrompt() {
  // macOS's own authentication dialog (offers Touch ID too where it can); needs an admin account
  return new Promise((resolve) =>
    execFile(
      '/usr/bin/osascript',
      ['-e', 'do shell script "true" with prompt "PR Deck wants to unlock." with administrator privileges'],
      (err) => resolve(err ? { ok: false, message: /cancel/i.test(String(err.message)) ? 'Cancelled' : 'Not unlocked' } : { ok: true }),
    ),
  )
}

function showLock() {
  locked = true
  window?.loadFile(join(HERE, 'lock.html'))
}
ipcMain.handle('prdeck:unlock', async () => {
  const r = await authenticate()
  if (r.ok) {
    locked = false
    window?.loadURL(BASE)
  }
  return r
})
// Lock again when the screen locks or the Mac sleeps
powerMonitor.on('lock-screen', () => prefs.requireUnlock && showLock())
powerMonitor.on('suspend', () => prefs.requireUnlock && showLock())

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (window) (window.isMinimized() && window.restore(), window.focus())
})

const healthy = () =>
  fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false)

/** Our own server, unless one already answers on the port */
async function startServer() {
  if (await healthy()) return
  mkdirSync(join(homedir(), 'Library', 'Logs'), { recursive: true })
  const log = createWriteStream(LOG, { flags: 'a' })
  // Apps opened from Finder get a bare PATH: add where node, Claude Code and gh usually live
  const path = [process.env.PATH, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':')
  server = spawn(process.execPath, [join(HERE, 'app', 'server', 'server.mjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PRDECK_PORT: String(PORT),
      PRDECK_WEB_DIR: join(HERE, 'app', 'web'),
      PRDECK_VERSION: app.getVersion(),
      PRDECK_INSTALL: 'desktop',
      PATH: path,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.pipe(log)
  server.stderr.pipe(log)
  server.on('exit', (code) => {
    server = null
    if (code && !app.isQuitting) dialog.showErrorBox('PR Deck', `The PR Deck server stopped (exit ${code}). See ${LOG}`)
  })
  for (let i = 0; i < 60; i++) {
    if (await healthy()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`The PR Deck server didn't start. See ${LOG}`)
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'PR Deck',
    backgroundColor: '#09090b',
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(HERE, 'preload.cjs') },
  })
  if (locked) window.loadFile(join(HERE, 'lock.html'))
  else window.loadURL(BASE)
  // Links and popups (GitHub, Jira, Slack) open in the browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return
    // While locked, nothing but the lock screen loads
    if (locked) return e.preventDefault()
    if (!url.startsWith(BASE)) (e.preventDefault(), shell.openExternal(url))
  })
  window.on('closed', () => (window = null))
}

/** Newer GitHub release? Offer its .dmg (the app isn't signed, so it can't replace itself) */
async function checkForUpdate(manual = false) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    const rel = await r.json()
    const latest = String(rel.tag_name).replace(/^v/, '')
    if (!newer(latest, app.getVersion())) {
      if (manual) dialog.showMessageBox({ message: `PR Deck ${app.getVersion()} is the latest version.` })
      return
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const dmgs = (rel.assets ?? []).filter((a) => a.name.endsWith('.dmg'))
    const dmg = dmgs.find((a) => a.name.includes(arch)) ?? dmgs[0]
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `PR Deck ${latest} is available`,
      detail: `You have ${app.getVersion()}. Download it, open the .dmg and drag PR Deck to Applications, replacing this one.`,
      buttons: ['Download', 'Release notes', 'Later'],
      defaultId: 0,
      cancelId: 2,
    })
    if (response === 0) shell.openExternal(dmg?.browser_download_url ?? rel.html_url)
    if (response === 1) shell.openExternal(rel.html_url)
  } catch (e) {
    if (manual) dialog.showErrorBox('PR Deck', `Couldn't check for updates: ${e.message}`)
  }
}

function newer(a, b) {
  const p = (v) => v.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

function setMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdate(true) },
        {
          label: 'Require Unlock',
          type: 'checkbox',
          checked: prefs.requireUnlock,
          click: async (item) => {
            // Turning it off needs an unlock too
            if (!item.checked && !(await authenticate()).ok) return (item.checked = true)
            prefs.requireUnlock = item.checked
            savePrefs()
          },
        },
        { label: 'Lock Now', accelerator: 'CmdOrCtrl+L', click: () => showLock() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  setMenu()
  try {
    await startServer()
  } catch (e) {
    dialog.showErrorBox('PR Deck', e.message)
    app.quit()
    return
  }
  createWindow()
  checkForUpdate()
  setInterval(checkForUpdate, 6 * 60 * 60_000)
  app.on('activate', () => !window && createWindow())
})

app.on('before-quit', () => {
  app.isQuitting = true
  server?.kill()
})
app.on('window-all-closed', () => {
  // Like other Mac apps: closing the window keeps PR Deck running in the Dock
})
