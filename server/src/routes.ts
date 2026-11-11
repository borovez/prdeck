import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { GithubAccount, Settings } from '../../shared/types.ts'
import {
  addManualDep,
  DB_PATH,
  getSettings,
  getSlackItem,
  getUiPrefs,
  listJira,
  removeManualDep,
  replaceJira,
  saveSettings,
  saveUiPrefs,
  setMeta,
  setSlackStatus,
} from './db.ts'
import { draftJiraFromSlack, envCredentials, testAi } from './ai.ts'
import { replyInThread, slackAuthTest, threadContext } from './slack.ts'
import { ghCliToken, listRepos, whoAmI } from './github.ts'
import { createIssue, getTransitions, jiraMyself, transition } from './jira.ts'
import { buildOverview } from './model.ts'
import { normaliseRef } from './refs.ts'
import { runSync } from './sync.ts'

export const api = new Hono()

api.onError((err, c) => {
  console.error('[api]', err.message)
  return c.json({ error: err.message }, (err as { status?: number }).status === 400 ? 400 : 500)
})

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 })

/** Tokens never leave the server. */
function maskSettings(s: Settings): Settings {
  return {
    ...s,
    github: { accounts: s.github.accounts.map((a) => ({ ...a, token: '', hasToken: !!a.token })) },
    jira: s.jira ? { ...s.jira, apiToken: '', hasToken: !!s.jira.apiToken } : null,
    slack: s.slack ? { ...s.slack, token: '', hasToken: !!s.slack.token } : null,
    ai: { ...s.ai, apiKey: '', hasKey: !!s.ai.apiKey },
  }
}

api.get('/health', (c) => c.json({ ok: true }))

api.get('/overview', (c) => c.json(buildOverview()))

api.post('/sync', async (c) => {
  await runSync()
  return c.json(buildOverview())
})

/** Header toggle: switch background sync on/off without sending the whole settings object */
api.put('/sync/auto', async (c) => {
  const { enabled } = (await c.req.json()) as { enabled: boolean }
  const s = getSettings()
  saveSettings({ ...s, sync: { ...s.sync, auto: !!enabled } })
  return c.json({ enabled: !!enabled })
})

// ---------- Settings ----------
api.get('/settings', (c) => c.json(maskSettings(getSettings())))

api.put('/settings', async (c) => {
  const incoming = (await c.req.json()) as Settings
  const current = getSettings()
  // Blank token = keep the stored one
  incoming.github.accounts = incoming.github.accounts.map((a) => {
    const prev = current.github.accounts.find((p) => p.id === a.id)
    const { hasToken: _h, ...rest } = a
    return { ...rest, id: a.id || randomUUID(), token: a.token || prev?.token || '' }
  })
  if (incoming.jira) {
    const { hasToken: _h, ...rest } = incoming.jira
    incoming.jira = { ...rest, baseUrl: rest.baseUrl.replace(/\/+$/, ''), apiToken: rest.apiToken || current.jira?.apiToken || '' }
  }
  if (incoming.slack) {
    const { hasToken: _h, ...rest } = incoming.slack
    const token = rest.token || current.slack?.token || ''
    let { userId, teamUrl } = rest
    if (token && (token !== current.slack?.token || !userId)) {
      const me = await slackAuthTest(token)
      userId = me.userId
      teamUrl = me.url
    }
    incoming.slack = { ...rest, token, userId, teamUrl }
  }
  {
    const { hasKey, ...rest } = incoming.ai ?? { apiKey: '', model: '' }
    // Blank key = keep the stored one, unless the client says there is no key any more (removed)
    const apiKey = rest.apiKey || (hasKey === false ? '' : current.ai.apiKey || '')
    incoming.ai = { ...rest, apiKey, model: rest.model || 'claude-opus-5-5' }
  }
  incoming.trackedRepos = [...new Set(incoming.trackedRepos.map((r) => r.trim().toLowerCase()).filter(Boolean))]
  incoming.releaseRefs = Object.fromEntries(
    Object.entries(incoming.releaseRefs ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]).filter(([, v]) => v),
  )
  saveSettings(incoming)
  return c.json(maskSettings(getSettings()))
})

// ---------- Setup helpers ----------
api.post('/setup/github/test', async (c) => {
  const { token, accountId } = await c.req.json<{ token?: string; accountId?: string }>()
  const t = token || getSettings().github.accounts.find((a) => a.id === accountId)?.token
  if (!t) throw bad('No token given')
  return c.json(await whoAmI(t))
})

/** Create (or refresh) an account from `gh auth token`. */
api.post('/setup/github/gh-cli', async (c) => {
  const token = await ghCliToken()
  const me = await whoAmI(token)
  const s = getSettings()
  const existing = s.github.accounts.find((a) => a.source === 'gh-cli')
  const account: GithubAccount = existing
    ? { ...existing, token, login: me.login }
    : { id: randomUUID(), label: `${me.login} (gh CLI)`, token, login: me.login, orgs: [], source: 'gh-cli' }
  s.github.accounts = existing ? s.github.accounts.map((a) => (a.id === account.id ? account : a)) : [...s.github.accounts, account]
  saveSettings(s)
  return c.json({ ...me, settings: maskSettings(s) })
})

api.get('/setup/github/:accountId/owners', async (c) => {
  const acc = getSettings().github.accounts.find((a) => a.id === c.req.param('accountId'))
  if (!acc?.token) throw bad('Unknown account')
  const me = await whoAmI(acc.token)
  return c.json([me.login, ...me.orgs])
})

api.get('/setup/github/:accountId/repos', async (c) => {
  const acc = getSettings().github.accounts.find((a) => a.id === c.req.param('accountId'))
  const owner = c.req.query('owner')
  if (!acc?.token || !owner) throw bad('Unknown account or owner')
  return c.json(await listRepos(acc.token, owner))
})

api.post('/setup/jira/test', async (c) => {
  const body = await c.req.json<{ baseUrl: string; email: string; apiToken?: string }>()
  const stored = getSettings().jira
  const cfg = {
    baseUrl: body.baseUrl,
    email: body.email,
    apiToken: body.apiToken || stored?.apiToken || '',
    projectKeys: [],
    myJql: '',
    create: { projectKey: '', issueType: 'Task', extraFieldsJson: '', assignToMe: false },
  }
  if (!cfg.apiToken) throw bad('No API token given')
  return c.json(await jiraMyself(cfg))
})

/** Command for wiring the MCP server into Claude Code. */
api.get('/setup/ai', (c) => c.json({ env: envCredentials() }))
api.post('/setup/ai/test', async (c) => {
  const { apiKey, model } = await c.req.json<{ apiKey?: string; model?: string }>()
  const stored = getSettings().ai
  return c.json(await testAi({ apiKey: apiKey || stored.apiKey, model: model || stored.model }))
})

api.get('/setup/mcp', (c) => {
  const mcpEntry = fileURLToPath(new URL('./mcp.ts', import.meta.url))
  const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
  const fallbackTsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
  return c.json({
    node: process.execPath,
    entry: mcpEntry,
    dbPath: DB_PATH,
    tsxCandidates: [tsx, fallbackTsx],
  })
})

// ---------- Dependencies ----------
const DepInput = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['merge', 'release']).default('merge'),
  note: z.string().nullish(),
})

api.post('/deps', async (c) => {
  const d = DepInput.parse(await c.req.json())
  const from = normaliseRef(d.from)
  const to = normaliseRef(d.to)
  if (!from || !to) throw bad('Use owner/repo#123 or a GitHub PR URL')
  if (from === to) throw bad('A PR cannot depend on itself')
  const id = addManualDep(from, to, d.kind, d.note ?? null)
  return c.json({ id, from, to })
})

api.delete('/deps/:id', (c) => c.json({ removed: removeManualDep(Number(c.req.param('id'))) }))

// ---------- Per-PR notes / pins ----------
api.put('/prs/meta', async (c) => {
  const { id, note, pinned } = await c.req.json<{ id: string; note: string | null; pinned: boolean }>()
  setMeta(id, note?.trim() || null, !!pinned)
  return c.json({ ok: true })
})

// ---------- Jira transitions ----------
api.get('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  return c.json(await getTransitions(cfg, c.req.param('key')))
})

api.post('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  const { id } = await c.req.json<{ id: string }>()
  const key = c.req.param('key')
  const updated = await transition(cfg, key, id)
  const all = listJira()
  const prev = all.find((i) => i.key === key)
  replaceJira(
    all.map((i) => (i.key === key ? { ...updated, isMine: prev?.isMine ?? false } : i)),
    new Date().toISOString(),
  )
  return c.json(updated)
})

api.post('/setup/slack/test', async (c) => {
  const { token } = await c.req.json<{ token?: string }>()
  const t = token || getSettings().slack?.token
  if (!t) throw bad('No Slack token given')
  return c.json(await slackAuthTest(t))
})

// ---------- UI prefs ----------
api.get('/prefs', (c) => c.json(getUiPrefs()))
api.put('/prefs', async (c) => {
  saveUiPrefs(await c.req.json())
  return c.json({ ok: true })
})

// ---------- Slack inbox ----------
api.put('/slack/:id/status', async (c) => {
  const { status } = await c.req.json<{ status: 'new' | 'done' | 'dismissed' }>()
  setSlackStatus(c.req.param('id'), status)
  return c.json({ ok: true })
})

api.get('/slack/:id/thread', async (c) => {
  const cfg = getSettings().slack
  const item = getSlackItem(c.req.param('id'))
  if (!cfg?.token || !item) throw bad('Unknown Slack item')
  return c.text(await threadContext(cfg, item))
})

/** Ask Claude to draft a Jira issue from the Slack message + its thread + my extra context. */
api.post('/slack/:id/draft', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const { context, projectKey } = await c.req.json<{ context?: string; projectKey?: string }>()
  const thread = await threadContext(s.slack, item)
  const draft = await draftJiraFromSlack(s.ai, item, thread, context ?? '', projectKey || s.jira?.create.projectKey || '')
  return c.json({ draft, thread })
})

const CreateInput = z.object({
  projectKey: z.string().min(1),
  issueType: z.string().min(1),
  summary: z.string().min(1),
  description: z.string(),
  labels: z.array(z.string()).default([]),
  slackItemId: z.string().nullish(),
  replyInThread: z.boolean().default(false),
})

/** Create a Jira issue (optionally linked to a Slack item, optionally replying in its thread). */
api.post('/jira/create', async (c) => {
  const s = getSettings()
  if (!s.jira?.apiToken) throw bad('Jira not configured')
  const input = CreateInput.parse(await c.req.json())
  const created = await createIssue(s.jira, input)
  let replied = false
  if (input.slackItemId) {
    const item = getSlackItem(input.slackItemId)
    if (item) {
      setSlackStatus(item.id, 'done', created.key)
      if (input.replyInThread && s.slack?.token) {
        await replyInThread(s.slack, item, `Tracked in Jira: <${created.url}|${created.key}> – ${input.summary}`)
        replied = true
      }
    }
  }
  return c.json({ ...created, replied })
})
