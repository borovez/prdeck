import type { SlackConfig, SlackItem, SlackKind, SlackMessage } from '../../shared/types.ts'
import { getSlackUsers, saveSlackUsers } from './db.ts'

// Slack Web API with a *user* token (xoxp-). Required user scopes:
//   search:read, im:history, mpim:history, im:read, mpim:read, channels:history,
//   groups:history, users:read, chat:write (only for replying with the Jira link)

export class SlackError extends Error {
  constructor(
    message: string,
    /** Slack's error code, e.g. channel_not_found */
    public code?: string,
  ) {
    super(message)
  }
}

/** A DM or group we can't read (deactivated user, external Slack Connect DM…): skip it, not a sync error */
const UNREADABLE = new Set(['channel_not_found', 'not_in_channel', 'is_archived', 'access_denied', 'method_not_supported_for_channel_type'])

async function call<T = any>(token: string, method: string, params: Record<string, string | number | undefined> = {}, attempt = 0): Promise<T> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v))
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('retry-after') ?? '5')
    await new Promise((r) => setTimeout(r, wait * 1000))
    return call(token, method, params, attempt + 1)
  }
  const json = (await res.json()) as { ok: boolean; error?: string; needed?: string }
  if (!json.ok) throw new SlackError(`Slack ${method}: ${json.error}${json.needed ? ` (needs scope ${json.needed})` : ''}`, json.error)
  return json as T
}

export async function slackAuthTest(token: string) {
  const r = await call<{ user_id: string; user: string; team: string; url: string }>(token, 'auth.test')
  return { userId: r.user_id, user: r.user, team: r.team, url: r.url }
}

// ---------- users ----------
async function resolveUsers(token: string, ids: Iterable<string>) {
  const cache = getSlackUsers()
  const missing = [...new Set(ids)].filter((id) => id && !cache[id])
  await pool(missing, 4, async (id) => {
    try {
      const r = await call(token, 'users.info', { user: id })
      cache[id] = {
        name: r.user.profile?.display_name || r.user.real_name || r.user.name,
        avatar: r.user.profile?.image_48 ?? null,
      }
    } catch {
      cache[id] = { name: id, avatar: null }
    }
  })
  if (missing.length) saveSlackUsers(cache)
  return cache
}

/** Channel id → "#name" / "DM" / "Group DM", cached for the life of the process */
const channelNames = new Map<string, string>()
async function resolveChannelNames(token: string, ids: string[]) {
  await pool([...new Set(ids)].filter((id) => !channelNames.has(id)), 4, async (id) => {
    try {
      const c = (await call(token, 'conversations.info', { channel: id })).channel
      channelNames.set(id, c.is_im ? 'DM' : c.is_mpim ? 'Group DM' : `#${c.name}`)
    } catch {
      channelNames.set(id, id) // no access: keep the id, don't retry every sync
    }
  })
  return channelNames
}

/** Keep Slack mrkdwn but name user mentions: <@U1> → <@U1|Name>, for the client to format */
export const namedMentions = (text: string, users: Record<string, { name: string }>) =>
  text.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `<@${id}|${users[id]?.name ?? id}>`)

/** Slack mrkdwn → readable text: <@U1>, <#C1|name>, <url|label>, entities. */
export function renderText(text: string, users: Record<string, { name: string }>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${users[id]?.name ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  }))
}

const tsToIso = (ts: string) => new Date(Number(ts.split('.')[0]) * 1000).toISOString()

export interface SlackFetchResult {
  items: { item: SlackItem; autoDone: boolean }[]
  errors: string[]
  /** Kinds whose source was read successfully – stale open items of these kinds can be closed */
  completeKinds: SlackKind[]
}

/**
 * Collects what needs my attention:
 *  - messages that @-mention me anywhere (search.messages)
 *  - DMs and group DMs where someone wrote after my last reply
 */
export async function fetchSlackInbox(cfg: SlackConfig): Promise<SlackFetchResult> {
  const errors: string[] = []
  const me = cfg.userId ?? (await slackAuthTest(cfg.token)).userId
  const since = new Date(Date.now() - cfg.lookbackDays * 86400_000)
  const oldest = String(Math.floor(since.getTime() / 1000))
  const raw: { kind: SlackKind; channelId: string; channelName: string; m: any; awaitingReply: boolean; autoDone: boolean; permalink: string | null }[] = []

  // 1. Mentions
  try {
    const r = await call(cfg.token, 'search.messages', {
      query: `<@${me}> after:${since.toISOString().slice(0, 10)}`,
      sort: 'timestamp',
      sort_dir: 'desc',
      count: 100,
    })
    for (const m of r.messages?.matches ?? []) {
      if (m.user === me) continue
      const ch = m.channel ?? {}
      const kind: SlackKind = ch.is_im ? 'dm' : ch.is_mpim ? 'group' : 'mention'
      const threadTs = /thread_ts=([\d.]+)/.exec(m.permalink ?? '')?.[1] ?? null
      raw.push({
        kind,
        channelId: ch.id,
        channelName: ch.is_im ? 'DM' : ch.is_mpim ? 'Group DM' : `#${ch.name}`,
        m: { ...m, thread_ts: m.thread_ts ?? threadTs },
        awaitingReply: false,
        autoDone: false,
        permalink: m.permalink ?? null,
      })
    }
  } catch (e) {
    errors.push((e as Error).message)
  }

  const completeKinds: SlackKind[] = []
  const channelLabel = (ch: string, isIm?: boolean, isMpim?: boolean, name?: string) =>
    isIm || ch.startsWith('D') ? 'DM' : isMpim || name?.startsWith('mpdm-') ? 'Group DM' : name ? `#${name}` : ch

  // 2a. Saved / bookmarked ("Later") messages – no lookback, they stay until unsaved
  if (cfg.includeSaved) {
    try {
      const r = await call(cfg.token, 'stars.list', { count: 200 }).catch((e) => {
        if (e instanceof SlackError && e.code === 'missing_scope')
          throw new SlackError('Saved messages need the stars:read scope: add it to your Slack app, reinstall, and paste the new token in Settings → Slack. Or turn off "Include saved messages".', e.code)
        throw e
      })
      for (const it of r.items ?? []) {
        if (it.type !== 'message' || !it.message) continue
        const m = it.message
        raw.push({
          kind: 'saved',
          channelId: it.channel,
          channelName: channelLabel(it.channel, undefined, undefined, m.channel_name),
          m,
          awaitingReply: false,
          autoDone: false,
          permalink: m.permalink ?? null,
        })
      }
      completeKinds.push('saved')
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  // 2b. Messages I marked with a todo reaction
  if (cfg.todoReactions?.length) {
    try {
      const clean = (list: string[] = []) => new Set(list.map((x) => x.replace(/:/g, '').trim()).filter(Boolean))
      const wanted = clean(cfg.todoReactions)
      const done = clean(cfg.doneReactions)
      const r = await call(cfg.token, 'reactions.list', { user: me, full: 'true', count: 200 })
      for (const it of r.items ?? []) {
        if (it.type !== 'message' || !it.message) continue
        const m = it.message
        const mineWith = (names: Set<string>) => (m.reactions ?? []).some((x: any) => names.has(x.name) && (x.users ?? []).includes(me))
        if (!mineWith(wanted)) continue
        raw.push({
          kind: 'todo',
          channelId: it.channel,
          channelName: channelLabel(it.channel, undefined, undefined, m.channel_name),
          m,
          awaitingReply: false,
          // Also reacted with a "done" emoji: completed
          autoDone: mineWith(done),
          permalink: m.permalink ?? null,
        })
      }
      completeKinds.push('todo')
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  // 3. DMs and group DMs: messages after my last message
  try {
    const convs: any[] = []
    let cursor: string | undefined
    do {
      const r = await call(cfg.token, 'users.conversations', { types: 'im,mpim', exclude_archived: 'true', limit: 200, cursor })
      convs.push(...r.channels)
      cursor = r.response_metadata?.next_cursor || undefined
    } while (cursor && convs.length < 1000)

    // most recently active first when Slack gives us `updated`, otherwise newest conversations first
    convs.sort((a, b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0))
    await pool(convs.slice(0, cfg.maxConversations), 3, async (c) => {
      try {
        const h = await call(cfg.token, 'conversations.history', { channel: c.id, oldest, limit: 20 })
        const msgs: any[] = (h.messages ?? []).filter((m: any) => !m.subtype || m.subtype === 'thread_broadcast')
        if (!msgs.length) return
        // history is newest first
        const lastMine = msgs.findIndex((m) => m.user === me)
        const unanswered = lastMine === -1 ? msgs : msgs.slice(0, lastMine)
        const answered = lastMine === -1 ? [] : msgs.slice(lastMine + 1)
        const kind: SlackKind = c.is_im ? 'dm' : 'group'
        for (const m of unanswered.slice(0, 5))
          raw.push({ kind, channelId: c.id, channelName: kind === 'dm' ? 'DM' : 'Group DM', m, awaitingReply: true, autoDone: false, permalink: null })
        // I replied after these – close them if they were still open
        for (const m of answered.filter((x) => x.user !== me).slice(0, 5))
          raw.push({ kind, channelId: c.id, channelName: kind === 'dm' ? 'DM' : 'Group DM', m, awaitingReply: false, autoDone: true, permalink: null })
      } catch (e) {
        if (!(e instanceof SlackError && e.code && UNREADABLE.has(e.code))) errors.push((e as Error).message)
      }
    })
  } catch (e) {
    errors.push((e as Error).message)
  }

  const users = await resolveUsers(
    cfg.token,
    raw.flatMap((r) => [r.m.user, ...[...String(r.m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  // Some sources (todo reactions, saved items) only give a channel id: look the names up
  const names = await resolveChannelNames(cfg.token, raw.filter((r) => r.channelName === r.channelId).map((r) => r.channelId))
  for (const r of raw) if (r.channelName === r.channelId && names.has(r.channelId)) r.channelName = names.get(r.channelId)!

  const base = (cfg.teamUrl ?? '').replace(/\/+$/, '')
  const items = new Map<string, { item: SlackItem; autoDone: boolean }>()
  // saved/todo first so they win over a plain mention of the same message
  raw.sort((a, b) => Number(['saved', 'todo'].includes(b.kind)) - Number(['saved', 'todo'].includes(a.kind)))
  for (const r of raw) {
    const id = `${r.channelId}:${r.m.ts}`
    if (items.has(id) && !r.autoDone) continue
    const u = users[r.m.user]
    items.set(id, {
      autoDone: r.autoDone,
      item: {
        id,
        channelId: r.channelId,
        channelName: r.channelName,
        kind: r.kind,
        ts: r.m.ts,
        threadTs: r.m.thread_ts && r.m.thread_ts !== r.m.ts ? r.m.thread_ts : null,
        user: r.m.user,
        userName: u?.name ?? r.m.username ?? r.m.user,
        userAvatar: u?.avatar ?? null,
        text: renderText(r.m.text ?? '', users),
        rich: namedMentions(r.m.text ?? '', users),
        permalink: r.permalink ?? (base ? `${base}/archives/${r.channelId}/p${r.m.ts.replace('.', '')}` : null),
        postedAt: tsToIso(r.m.ts),
        awaitingReply: r.awaitingReply,
        status: 'new',
        jiraKey: null,
      },
    })
  }
  return { items: [...items.values()], errors, completeKinds }
}

/** Full thread (or surrounding messages) as plain text, for drafting a ticket. */
export async function threadContext(cfg: SlackConfig, item: SlackItem): Promise<string> {
  let msgs: any[] = []
  try {
    const r = await call(cfg.token, 'conversations.replies', { channel: item.channelId, ts: item.threadTs ?? item.ts, limit: 60 })
    msgs = r.messages ?? []
  } catch {
    /* not a thread or no access */
  }
  if (msgs.length <= 1) {
    // No thread: take the conversation around the message
    try {
      const r = await call(cfg.token, 'conversations.history', { channel: item.channelId, latest: item.ts, inclusive: 'true', limit: 15 })
      msgs = (r.messages ?? []).reverse()
    } catch {
      msgs = [{ user: item.user, text: item.text, ts: item.ts }]
    }
  }
  const users = await resolveUsers(
    cfg.token,
    msgs.flatMap((m) => [m.user, ...[...String(m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  return msgs
    .map((m) => `[${tsToIso(m.ts).slice(0, 16).replace('T', ' ')}] ${users[m.user]?.name ?? m.user}${m.ts === item.ts ? ' (★ the message in question)' : ''}: ${renderText(m.text ?? '', users)}`)
    .join('\n')
}

/**
 * `n` messages before and after an inbox item, oldest first. A thread reply gets its neighbours in
 * the thread; anything else gets its neighbours in the channel or DM.
 */
export async function messagesAround(cfg: SlackConfig, item: SlackItem, n = 2): Promise<SlackMessage[]> {
  const visible = (m: any) => !m.subtype || m.subtype === 'thread_broadcast' || m.subtype === 'bot_message' || m.subtype === 'file_share'
  let msgs: any[]
  if (item.threadTs) {
    const r = await call(cfg.token, 'conversations.replies', { channel: item.channelId, ts: item.threadTs, limit: 200 })
    msgs = (r.messages ?? []).filter(visible) // oldest first, parent included
  } else {
    // History is newest first. Before: up to the item. After: a week's window from the item, keep the oldest.
    const [before, after] = await Promise.all([
      call(cfg.token, 'conversations.history', { channel: item.channelId, latest: item.ts, inclusive: 'true', limit: n + 6 }),
      call(cfg.token, 'conversations.history', { channel: item.channelId, oldest: item.ts, latest: String(Number(item.ts) + 7 * 86400), limit: 200 }),
    ])
    const prev = (before.messages ?? []).filter(visible).reverse() // oldest first, ends with the item
    const next = (after.messages ?? []).filter(visible).reverse().filter((m: any) => m.ts !== item.ts) // oldest first
    msgs = [...prev, ...next]
  }
  let i = msgs.findIndex((m) => m.ts === item.ts)
  if (i < 0) {
    // Deleted or not visible: show the item on its own
    msgs = [{ ts: item.ts, user: item.user, text: item.text }]
    i = 0
  }
  const window = msgs.slice(Math.max(0, i - n), i + n + 1)
  const users = await resolveUsers(
    cfg.token,
    window.flatMap((m) => [m.user, ...[...String(m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1])]),
  )
  return window.map((m) => ({
    ts: m.ts,
    user: m.user ?? '',
    userName: users[m.user]?.name ?? m.username ?? m.user ?? 'Unknown',
    userAvatar: users[m.user]?.avatar ?? null,
    text: renderText(m.text ?? '', users),
    rich: namedMentions(m.text ?? '', users),
    postedAt: tsToIso(m.ts),
    isTarget: m.ts === item.ts,
  }))
}

export async function replyInThread(cfg: SlackConfig, item: SlackItem, text: string) {
  await call(cfg.token, 'chat.postMessage', { channel: item.channelId, thread_ts: item.threadTs ?? item.ts, text })
}
