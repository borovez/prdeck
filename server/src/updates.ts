import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { UpdateStatus } from '../../shared/types.ts'
import { kvGet, kvSet } from './db.ts'

const run = promisify(execFile)
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** The desktop app passes its version and how it was installed; a source checkout reads package.json */
const DESKTOP = process.env.PRDECK_INSTALL === 'desktop'
const pkg: { version: string; repository?: string } = DESKTOP
  ? { version: process.env.PRDECK_VERSION ?? '0.0.0' }
  : JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
export const VERSION = pkg.version
const REPO = (pkg.repository ?? 'github:borovez/prdeck').replace(/^github:/, '')
const CHECK_EVERY_MS = 6 * 60 * 60_000
export const UPDATE_LOG = join(homedir(), 'Library', 'Logs', 'PRDeck-update.log')

/** 1.2.3 vs 1.10.0, ignoring a leading v */
export function newer(a: string, b: string) {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

type Latest =
  | { version: string; url: string; notes: string; publishedAt: string; checkedAt: string; downloadUrl?: string | null }
  | { error: string; checkedAt: string }

/** The newest GitHub release of this repo (no token needed for a public repo); cached six hours */
async function latestRelease(force: boolean): Promise<Latest> {
  const cached = kvGet<Latest | null>('updateCheck', null)
  if (!force && cached && Date.now() - Date.parse(cached.checkedAt) < CHECK_EVERY_MS) return cached
  const checkedAt = new Date().toISOString()
  let latest: Latest
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) latest = { version: VERSION, url: `https://github.com/${REPO}/releases`, notes: '', publishedAt: '', checkedAt }
    else if (!res.ok) latest = { error: `GitHub ${res.status}`, checkedAt }
    else {
      const r = (await res.json()) as {
        tag_name: string
        html_url: string
        body: string | null
        published_at: string
        assets?: { name: string; browser_download_url: string }[]
      }
      // The Mac app's .dmg for this machine's chip, if the release has one
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const dmgs = (r.assets ?? []).filter((a) => a.name.endsWith('.dmg'))
      const dmg = dmgs.find((a) => a.name.includes(arch)) ?? dmgs[0]
      latest = { version: r.tag_name.replace(/^v/, ''), url: r.html_url, notes: r.body ?? '', publishedAt: r.published_at, checkedAt, downloadUrl: dmg?.browser_download_url ?? null }
    }
  } catch (e) {
    latest = { error: (e as Error).message, checkedAt }
  }
  kvSet('updateCheck', latest)
  return latest
}

/** Whether this install can update itself, and why not */
async function selfUpdate(): Promise<{ can: boolean; reason: string | null }> {
  if (DESKTOP) return { can: false, reason: 'Download the new version and drag it to Applications (replacing this one).' }
  if (!existsSync(join(ROOT, '.git'))) return { can: false, reason: 'Not installed from a git checkout: download the new version instead.' }
  try {
    const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT })
    if (stdout.trim()) return { can: false, reason: 'This checkout has local changes: commit or stash them, then update (npm run app:update).' }
  } catch {
    return { can: false, reason: 'git is not available.' }
  }
  if (process.env.NODE_ENV !== 'production') return { can: false, reason: 'Running in dev mode: pull the latest code (npm run app:update rebuilds it).' }
  return { can: true, reason: null }
}

let updating = false
/** The last run of the update script, if it failed (kept until the next attempt) */
let failed: { at: string; message: string } | null = null
const logTail = () => {
  try {
    return readFileSync(UPDATE_LOG, 'utf8').trimEnd().split('\n').slice(-6).join('\n')
  } catch {
    return ''
  }
}

export async function updateStatus(force = false): Promise<UpdateStatus> {
  const [latest, self] = await Promise.all([latestRelease(force), selfUpdate()])
  const ok = 'version' in latest
  return {
    current: VERSION,
    latest: ok ? latest.version : null,
    available: ok && newer(latest.version, VERSION),
    url: ok ? latest.url : `https://github.com/${REPO}/releases`,
    downloadUrl: ok ? (latest.downloadUrl ?? null) : null,
    desktop: DESKTOP,
    notes: ok ? latest.notes : '',
    publishedAt: ok ? latest.publishedAt || null : null,
    checkedAt: latest.checkedAt,
    error: ok ? null : latest.error,
    canSelfUpdate: self.can,
    reason: self.reason,
    updating,
    failed,
    log: UPDATE_LOG,
  }
}

/** Runs scripts/app-update.sh detached, so it survives this server being restarted at the end */
export async function startUpdate() {
  const self = await selfUpdate()
  if (!self.can) throw new Error(self.reason ?? 'Can’t update this install')
  if (updating) return
  mkdirSync(join(homedir(), 'Library', 'Logs'), { recursive: true })
  const out = openSync(UPDATE_LOG, 'a')
  const child = spawn('sh', [join(ROOT, 'scripts', 'app-update.sh')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: process.env })
  // A successful update restarts this server, so only a failure is ever seen here
  child.on('exit', (code) => {
    updating = false
    if (code) failed = { at: new Date().toISOString(), message: logTail() || `The update script exited with ${code}` }
  })
  child.unref()
  failed = null
  updating = true
}
