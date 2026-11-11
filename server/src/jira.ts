import type { JiraConfig, JiraIssue, JiraLink } from '../../shared/types.ts'

const FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'parent',
  'fixVersions',
  'labels',
  'updated',
  'issuelinks',
]

export class JiraError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

const base = (cfg: Pick<JiraConfig, 'baseUrl'>) => cfg.baseUrl.replace(/\/+$/, '')

async function request<T>(cfg: JiraConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(base(cfg) + path, {
    ...init,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64'),
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new JiraError(`Jira ${res.status} ${path}: ${text.slice(0, 300)}`, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function jiraMyself(cfg: JiraConfig) {
  const me = await request<{ accountId: string; displayName: string; emailAddress?: string }>(cfg, '/rest/api/3/myself')
  return { accountId: me.accountId, displayName: me.displayName }
}

function mapIssue(cfg: JiraConfig, raw: any, isMine: boolean): JiraIssue {
  const f = raw.fields ?? {}
  const links: JiraLink[] = (f.issuelinks ?? []).map((l: any) => {
    const inward = !!l.inwardIssue
    const other = l.inwardIssue ?? l.outwardIssue
    return {
      type: l.type?.name ?? '',
      direction: inward ? 'inward' : 'outward',
      label: inward ? l.type?.inward : l.type?.outward,
      key: other?.key,
      summary: other?.fields?.summary ?? '',
      status: other?.fields?.status?.name ?? '',
      statusCategory: other?.fields?.status?.statusCategory?.key ?? '',
    }
  })
  return {
    key: raw.key,
    url: `${base(cfg)}/browse/${raw.key}`,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? '',
    type: f.issuetype?.name ?? '',
    typeIconUrl: f.issuetype?.iconUrl ?? null,
    priority: f.priority?.name ?? null,
    priorityIconUrl: f.priority?.iconUrl ?? null,
    assignee: f.assignee
      ? {
          displayName: f.assignee.displayName,
          accountId: f.assignee.accountId,
          avatarUrl: f.assignee.avatarUrls?.['24x24'] ?? null,
        }
      : null,
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary ?? '' } : null,
    fixVersions: (f.fixVersions ?? []).map((v: any) => v.name),
    labels: f.labels ?? [],
    updated: f.updated,
    links,
    isMine,
  }
}

/** Enhanced JQL search (the old /search endpoint is gone on Jira Cloud). */
export async function searchJql(cfg: JiraConfig, jql: string, isMine: boolean, max = 200): Promise<JiraIssue[]> {
  const out: JiraIssue[] = []
  let nextPageToken: string | undefined
  do {
    const page = await request<{ issues: any[]; nextPageToken?: string; isLast?: boolean }>(cfg, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, fields: FIELDS, maxResults: 100, nextPageToken }),
    })
    out.push(...page.issues.map((i) => mapIssue(cfg, i, isMine)))
    nextPageToken = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined
  } while (nextPageToken && out.length < max)
  return out
}

/**
 * Fetch issues by key. A JQL `key in (...)` fails as a whole if one key doesn't exist,
 * so on 400 we fall back to fetching keys one by one and skip the missing ones.
 */
export async function fetchIssuesByKey(cfg: JiraConfig, keys: string[]): Promise<{ issues: JiraIssue[]; missing: string[] }> {
  const issues: JiraIssue[] = []
  const missing: string[] = []
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80)
    try {
      issues.push(...(await searchJql(cfg, `key in (${chunk.join(',')})`, false)))
    } catch (e) {
      if (!(e instanceof JiraError) || e.status !== 400) throw e
      for (const key of chunk) {
        try {
          const raw = await request<any>(cfg, `/rest/api/3/issue/${key}?fields=${FIELDS.join(',')}`)
          issues.push(mapIssue(cfg, raw, false))
        } catch (err) {
          if (err instanceof JiraError && (err.status === 404 || err.status === 403)) missing.push(key)
          else throw err
        }
      }
    }
  }
  return { issues, missing }
}

export async function getTransitions(cfg: JiraConfig, key: string) {
  const r = await request<{ transitions: { id: string; name: string; to: { name: string; statusCategory: { key: string } } }[] }>(
    cfg,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
  )
  return r.transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name, toCategory: t.to.statusCategory.key }))
}

export async function transition(cfg: JiraConfig, key: string, transitionId: string) {
  await request(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  })
  const raw = await request<any>(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`)
  return mapIssue(cfg, raw, false)
}

// ---------- Create ----------

/** Minimal Markdown → Atlassian Document Format: headings, bullet/numbered lists, code fences, paragraphs, links. */
export function markdownToAdf(md: string): any {
  const inline = (text: string): any[] => {
    const out: any[] = []
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
      const t = m[0]
      if (t.startsWith('**')) out.push({ type: 'text', text: t.slice(2, -2), marks: [{ type: 'strong' }] })
      else if (t.startsWith('`')) out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'code' }] })
      else if (t.startsWith('[')) {
        const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
        out.push({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
      } else out.push({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href: t } }] })
      last = m.index! + t.length
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
    return out.length ? out : [{ type: 'text', text: ' ' }]
  }
  const content: any[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith('```')) {
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: inline(h[2]) })
      continue
    }
    const listRe = /^\s*([-*]|\d+\.)\s+(.*)$/
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: any[] = []
      while (i < lines.length && listRe.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(listRe.exec(lines[i])![2]) }] })
        i++
      }
      i--
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items })
      continue
    }
    const para = [line]
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) para.push(lines[++i])
    content.push({ type: 'paragraph', content: inline(para.join(' ')) })
  }
  return { type: 'doc', version: 1, content }
}

export async function createIssue(
  cfg: JiraConfig,
  input: { projectKey: string; issueType: string; summary: string; description: string; labels?: string[] },
): Promise<{ key: string; url: string }> {
  let extra: Record<string, unknown> = {}
  if (cfg.create?.extraFieldsJson?.trim()) {
    try {
      extra = JSON.parse(cfg.create.extraFieldsJson)
    } catch {
      throw new JiraError('Jira "extra fields" setting is not valid JSON')
    }
  }
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    issuetype: { name: input.issueType },
    summary: input.summary.slice(0, 254),
    description: markdownToAdf(input.description),
    ...(input.labels?.length ? { labels: input.labels.map((l) => l.replace(/\s+/g, '-')) } : {}),
    ...extra,
  }
  if (cfg.create?.assignToMe) fields.assignee = { accountId: (await jiraMyself(cfg)).accountId }
  const r = await request<{ key: string }>(cfg, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) })
  return { key: r.key, url: `${base(cfg)}/browse/${r.key}` }
}
