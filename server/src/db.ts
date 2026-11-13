import './quiet.ts'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  DependencyKind,
  JiraIssue,
  PrId,
  SlackItem,
  SlackStatus,
  PrRecord,
  Relation,
  ReleaseInfo,
  ReleaseContents,
  BackmergeInfo,
  TagRelease,
  FeatureFlag,
  Settings,
  SyncState,
} from '../../shared/types.ts'
import { DEFAULT_SETTINGS } from '../../shared/types.ts'
import { deleteSecret, KEYCHAIN_MARK, keychainEnabled, readSecret, writeSecret } from './secrets.ts'

export const DATA_DIR = process.env.PRDECK_DATA_DIR ?? join(homedir(), '.prdeck')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
export const DB_PATH = join(DATA_DIR, 'prdeck.db')

// Shared by the API server and the MCP server (separate processes) – WAL keeps that safe.
export const db = new DatabaseSync(DB_PATH)
// Freed pages are zeroed, so old values (e.g. tokens moved to the Keychain) don't linger in the file
db.exec('PRAGMA secure_delete = ON')
try {
  chmodSync(DB_PATH, 0o600) // tokens live in here
} catch {}
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS prs (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    relations TEXT NOT NULL DEFAULT '[]',
    release TEXT,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jira_issues (key TEXT PRIMARY KEY, data TEXT NOT NULL, synced_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_pr TEXT NOT NULL,
    to_pr TEXT NOT NULL,
    kind TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (from_pr, to_pr)
  );
  CREATE TABLE IF NOT EXISTS slack_items (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    jira_key TEXT,
    posted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pr_meta (pr_id TEXT PRIMARY KEY, note TEXT, pinned INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS release_contents (pr_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS backmerges (pr_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS feature_flags (key TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tag_contents (id TEXT PRIMARY KEY, repo TEXT NOT NULL, data TEXT NOT NULL);
`)

// ---------- kv ----------
export function kvGet<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}
export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  )
}

// ---------- Secrets: in the macOS Keychain, a marker in the database (see secrets.ts) ----------

type Slot = { name: string; label: string; get: () => string | undefined; set: (v: string) => void }
/** Every secret in a settings object, with where it lives */
function secretSlots(s: Partial<Settings>): Slot[] {
  const slots: Slot[] = (s.github?.accounts ?? []).map((a) => ({
    name: `github:${a.id}`,
    label: `PR Deck: GitHub token (${a.label || a.login || a.id})`,
    get: () => a.token,
    set: (v) => (a.token = v),
  }))
  if (s.jira) slots.push({ name: 'jira', label: 'PR Deck: Jira API token', get: () => s.jira!.apiToken, set: (v) => (s.jira!.apiToken = v) })
  if (s.slack) slots.push({ name: 'slack', label: 'PR Deck: Slack token', get: () => s.slack!.token, set: (v) => (s.slack!.token = v) })
  if (s.launchdarkly)
    slots.push({ name: 'launchdarkly', label: 'PR Deck: LaunchDarkly token', get: () => s.launchdarkly!.apiToken, set: (v) => (s.launchdarkly!.apiToken = v) })
  if (s.ai) slots.push({ name: 'anthropic', label: 'PR Deck: Anthropic API key', get: () => s.ai!.apiKey, set: (v) => (s.ai!.apiKey = v) })
  return slots
}

/** Settings as stored, with secrets read from the Keychain; plaintext secrets left in the database move there first */
function storedSettings(): Partial<Settings> {
  const s = kvGet<Partial<Settings>>('settings', {})
  if (!keychainEnabled) return s
  let moved = false
  for (const slot of secretSlots(s)) {
    const v = slot.get()
    if (!v || v === KEYCHAIN_MARK) continue
    // Only blanked in the database once the Keychain read it back identically
    writeSecret(slot.name, v, slot.label)
    slot.set(KEYCHAIN_MARK)
    moved = true
  }
  if (moved) {
    kvSet('settings', s)
    // Rewrite the file so the old plaintext isn't left in free pages or the write-ahead log
    try {
      db.exec('VACUUM')
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* busy: secure_delete still zeroes the old pages as they're reused */
    }
  }
  for (const slot of secretSlots(s)) if (slot.get() === KEYCHAIN_MARK) slot.set(readSecret(slot.name) ?? '')
  return s
}

export function getSettings(): Settings {
  const s = storedSettings()
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    github: { accounts: s.github?.accounts ?? [] },
    sync: { ...DEFAULT_SETTINGS.sync, ...s.sync },
    dependencies: { ...DEFAULT_SETTINGS.dependencies, ...s.dependencies },
    launchdarkly: s.launchdarkly ?? null,
    releaseRefs: s.releaseRefs ?? {},
    // Older settings have no provider: a stored key means the API was in use
    ai: { ...DEFAULT_SETTINGS.ai, ...s.ai, provider: s.ai?.provider ?? (s.ai?.apiKey ? 'api' : 'claude-code') },
    jira: s.jira
      ? {
          ...s.jira,
          create: (({ extraFieldsJson: _gone, ...c }: Partial<NonNullable<Settings['jira']>['create']> & { extraFieldsJson?: string }) => ({
            projectKey: s.jira!.projectKeys?.[0] ?? '',
            issueType: 'Task',
            assignToMe: true,
            ...c,
          }))((s.jira.create ?? {}) as Partial<NonNullable<Settings['jira']>['create']>),
        }
      : null,
    slack: s.slack ? { lookbackDays: 7, maxConversations: 40, includeSaved: true, todoReactions: ['todo', 'eyes', 'bookmark'], doneReactions: ['white_check_mark', 'heavy_check_mark', 'done'], ...(s.slack as Partial<NonNullable<Settings['slack']>>), token: s.slack.token, userId: s.slack.userId ?? null, teamUrl: s.slack.teamUrl ?? null } : null,
  }
}
export function saveSettings(s: Settings) {
  if (!keychainEnabled) return kvSet('settings', s)
  const out = structuredClone(s)
  const before = new Map(secretSlots(kvGet<Partial<Settings>>('settings', {})).map((x) => [x.name, x.get()]))
  for (const slot of secretSlots(out)) {
    const v = slot.get()
    if (v && v !== KEYCHAIN_MARK) {
      if (readSecret(slot.name) !== v) writeSecret(slot.name, v, slot.label)
      slot.set(KEYCHAIN_MARK)
    } else if (!v) {
      // Cleared on purpose, or unreadable (a locked keychain): only delete what can be read, else keep the reference
      if (readSecret(slot.name) !== null) {
        deleteSecret(slot.name)
        slot.set('')
      } else slot.set(before.get(slot.name) === KEYCHAIN_MARK ? KEYCHAIN_MARK : '')
    }
  }
  // Secrets of accounts or integrations that were removed
  const keep = new Set(secretSlots(out).map((x) => x.name))
  for (const slot of secretSlots(kvGet<Partial<Settings>>('settings', {}))) if (!keep.has(slot.name)) deleteSecret(slot.name)
  kvSet('settings', out)
}

const EMPTY_SYNC: SyncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  errors: [],
  counts: null,
}
export const getSyncState = (): SyncState => ({ ...EMPTY_SYNC, ...kvGet<Partial<SyncState>>('sync', {}) })
export const saveSyncState = (s: SyncState) => kvSet('sync', s)
export const getMyLogins = (): string[] => kvGet<string[]>('me', [])
export const saveMyLogins = (l: string[]) => kvSet('me', l)
export const getMyJiraKeys = (): string[] => kvGet<string[]>('myJiraKeys', [])
export const saveMyJiraKeys = (k: string[]) => kvSet('myJiraKeys', k)

// ---------- PRs ----------
export interface StoredPr {
  pr: PrRecord
  relations: Relation[]
  release: ReleaseInfo | null
}

export function listPrs(): StoredPr[] {
  const rows = db.prepare('SELECT data, relations, release FROM prs').all() as {
    data: string
    relations: string
    release: string | null
  }[]
  return rows.map((r) => ({
    pr: JSON.parse(r.data),
    relations: JSON.parse(r.relations),
    release: r.release ? JSON.parse(r.release) : null,
  }))
}

export function upsertPr(pr: PrRecord, relations: Relation[], syncedAt: string) {
  db.prepare(
    `INSERT INTO prs (id, data, relations, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, relations = excluded.relations, synced_at = excluded.synced_at`,
  ).run(pr.id, JSON.stringify(pr), JSON.stringify(relations), syncedAt)
}

/** One PR re-read from GitHub outside a sync (relations and sync time stay as they were) */
export function updatePrData(pr: PrRecord) {
  db.prepare('UPDATE prs SET data = ? WHERE id = ?').run(JSON.stringify(pr), pr.id)
}

/** Local copy of a PR description after PR Deck edited it on GitHub (the next sync confirms it) */
export function setPrTitle(id: PrId, title: string) {
  db.prepare("UPDATE prs SET data = json_set(data, '$.title', ?) WHERE id = ?").run(title, id)
}

export function setPrBody(id: PrId, body: string) {
  db.prepare("UPDATE prs SET data = json_set(data, '$.body', ?) WHERE id = ?").run(body, id)
}

export function setRelease(id: PrId, release: ReleaseInfo) {
  db.prepare('UPDATE prs SET release = ? WHERE id = ?').run(JSON.stringify(release), id)
}

// ---------- release contents / hotfix backmerges ----------
export function listReleaseContents(): ReleaseContents[] {
  return (db.prepare('SELECT data FROM release_contents').all() as { data: string }[]).map((r) => JSON.parse(r.data))
}
export function setReleaseContents(c: ReleaseContents) {
  db.prepare('INSERT INTO release_contents (pr_id, data) VALUES (?, ?) ON CONFLICT(pr_id) DO UPDATE SET data = excluded.data').run(c.prId, JSON.stringify(c))
}
export function listTagContents(): TagRelease[] {
  return (db.prepare('SELECT data FROM tag_contents').all() as { data: string }[]).map((r) => JSON.parse(r.data))
}
export function setTagContents(t: TagRelease) {
  db.prepare('INSERT INTO tag_contents (id, repo, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(t.prId, t.repo.toLowerCase(), JSON.stringify(t))
}
/** Keep only the given tags of a repo (older ones drop off) */
export function pruneTagContents(repo: string, keep: string[]) {
  const rows = db.prepare('SELECT id FROM tag_contents WHERE repo = ?').all(repo.toLowerCase()) as { id: string }[]
  const del = db.prepare('DELETE FROM tag_contents WHERE id = ?')
  for (const { id } of rows) if (!keep.includes(id)) del.run(id)
}

export function listFeatureFlags(): FeatureFlag[] {
  return (db.prepare('SELECT data FROM feature_flags').all() as { data: string }[]).map((r) => JSON.parse(r.data))
}
/** Replace the cached flags with these (flags no PR mentions any more drop off) */
export function replaceFeatureFlags(flags: FeatureFlag[]) {
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM feature_flags')
    const ins = db.prepare('INSERT INTO feature_flags (key, data) VALUES (?, ?)')
    for (const f of flags) ins.run(f.key, JSON.stringify(f))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function listBackmerges(): Map<PrId, BackmergeInfo> {
  const rows = db.prepare('SELECT pr_id, data FROM backmerges').all() as { pr_id: string; data: string }[]
  return new Map(rows.map((r) => [r.pr_id, JSON.parse(r.data)]))
}
export function setBackmerge(id: PrId, info: BackmergeInfo) {
  db.prepare('INSERT INTO backmerges (pr_id, data) VALUES (?, ?) ON CONFLICT(pr_id) DO UPDATE SET data = excluded.data').run(id, JSON.stringify(info))
}

export function deletePrsNotSyncedAt(syncedAt: string, keep: Set<PrId>) {
  const stale = db.prepare('SELECT id FROM prs WHERE synced_at <> ?').all(syncedAt) as { id: string }[]
  const del = db.prepare('DELETE FROM prs WHERE id = ?')
  const delContents = db.prepare('DELETE FROM release_contents WHERE pr_id = ?')
  const delBackmerge = db.prepare('DELETE FROM backmerges WHERE pr_id = ?')
  for (const { id } of stale) if (!keep.has(id)) (del.run(id), delContents.run(id), delBackmerge.run(id))
}

// ---------- Jira ----------
export function listJira(): JiraIssue[] {
  return (db.prepare('SELECT data FROM jira_issues').all() as { data: string }[]).map((r) => JSON.parse(r.data))
}
/** One issue after a write from the composer or a reload; keeps whether it's mine (and parent-only) from the last sync */
export function upsertJira(issue: JiraIssue) {
  const old = db.prepare('SELECT data FROM jira_issues WHERE key = ?').get(issue.key) as { data: string } | undefined
  const prev = old ? (JSON.parse(old.data) as JiraIssue) : null
  const isMine = prev ? prev.isMine : issue.isMine
  const parentOnly = prev ? prev.parentOnly : issue.parentOnly
  db.prepare('INSERT INTO jira_issues (key, data, synced_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data').run(
    issue.key,
    JSON.stringify({ ...issue, isMine, parentOnly }),
    new Date().toISOString(),
  )
}
export function replaceJira(issues: JiraIssue[], syncedAt: string) {
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM jira_issues')
    const ins = db.prepare('INSERT INTO jira_issues (key, data, synced_at) VALUES (?, ?, ?)')
    for (const i of issues) ins.run(i.key, JSON.stringify(i), syncedAt)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ---------- Manual dependencies ----------
export interface ManualDep {
  id: number
  from: PrId
  to: PrId
  kind: DependencyKind
  note: string | null
}
export function listManualDeps(): ManualDep[] {
  return db.prepare('SELECT id, from_pr AS "from", to_pr AS "to", kind, note FROM dependencies').all() as unknown as ManualDep[]
}
export function addManualDep(from: PrId, to: PrId, kind: DependencyKind, note: string | null): number {
  const r = db
    .prepare(
      `INSERT INTO dependencies (from_pr, to_pr, kind, note, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_pr, to_pr) DO UPDATE SET kind = excluded.kind, note = excluded.note
       RETURNING id`,
    )
    .get(from, to, kind, note, new Date().toISOString()) as { id: number }
  return r.id
}
export function removeManualDep(id: number): boolean {
  return db.prepare('DELETE FROM dependencies WHERE id = ?').run(id).changes > 0
}

// ---------- Per-PR meta ----------
export function listMeta(): Map<PrId, { note: string | null; pinned: boolean }> {
  const rows = db.prepare('SELECT pr_id, note, pinned FROM pr_meta').all() as {
    pr_id: string
    note: string | null
    pinned: number
  }[]
  return new Map(rows.map((r) => [r.pr_id, { note: r.note, pinned: !!r.pinned }]))
}
export function setMeta(id: PrId, note: string | null, pinned: boolean) {
  db.prepare(
    `INSERT INTO pr_meta (pr_id, note, pinned) VALUES (?, ?, ?)
     ON CONFLICT(pr_id) DO UPDATE SET note = excluded.note, pinned = excluded.pinned`,
  ).run(id, note, pinned ? 1 : 0)
}

// ---------- Slack ----------
export function listSlack(): SlackItem[] {
  const rows = db.prepare('SELECT data, status, jira_key FROM slack_items ORDER BY posted_at DESC').all() as {
    data: string
    status: SlackStatus
    jira_key: string | null
  }[]
  return rows.map((r) => ({ ...JSON.parse(r.data), status: r.status, jiraKey: r.jira_key }))
}

export function getSlackItem(id: string): SlackItem | null {
  const r = db.prepare('SELECT data, status, jira_key FROM slack_items WHERE id = ?').get(id) as
    | { data: string; status: SlackStatus; jira_key: string | null }
    | undefined
  return r ? { ...JSON.parse(r.data), status: r.status, jiraKey: r.jira_key } : null
}

/** Upsert content; status/jira link are user state and survive re-syncs (unless autoDone). */
export function upsertSlackItem(item: SlackItem, autoDone: boolean) {
  const { status: _s, jiraKey: _j, ...data } = item
  db.prepare(
    `INSERT INTO slack_items (id, data, status, posted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data,
       status = CASE WHEN ? AND slack_items.status = 'new' THEN 'done' ELSE slack_items.status END`,
  ).run(item.id, JSON.stringify(data), autoDone ? 'done' : 'new', item.postedAt, autoDone ? 1 : 0)
}

export function setSlackStatus(id: string, status: SlackStatus, jiraKey?: string | null) {
  if (jiraKey !== undefined) db.prepare('UPDATE slack_items SET status = ?, jira_key = ? WHERE id = ?').run(status, jiraKey, id)
  else db.prepare('UPDATE slack_items SET status = ? WHERE id = ?').run(status, id)
}

export function pruneSlack(olderThanIso: string) {
  db.prepare("DELETE FROM slack_items WHERE posted_at < ? AND status <> 'new'").run(olderThanIso)
}

export const getSlackUsers = () => kvGet<Record<string, { name: string; avatar: string | null }>>('slackUsers', {})
export const saveSlackUsers = (u: Record<string, { name: string; avatar: string | null }>) => kvSet('slackUsers', u)

// ---------- UI preferences (layout, panels, sorting) ----------
export const getUiPrefs = () => kvGet<Record<string, unknown>>('uiPrefs', {})
export const saveUiPrefs = (p: Record<string, unknown>) => kvSet('uiPrefs', p)

/** Close open saved/todo items that are no longer saved / reacted in Slack. */
export function closeStaleSlack(kinds: string[], seen: Set<string>) {
  for (const it of listSlack())
    if (it.status === 'new' && kinds.includes(it.kind) && !seen.has(it.id)) setSlackStatus(it.id, 'done')
}
