import { markdownToAdf, type AdfDoc } from '../../shared/adf.ts'
import type { JiraConfig, JiraIssue, JiraIssueDetail, JiraLink, JiraRequiredField } from '../../shared/types.ts'

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
    parent: f.parent
      ? {
          key: f.parent.key,
          summary: f.parent.fields?.summary ?? '',
          status: f.parent.fields?.status?.name,
          statusCategory: f.parent.fields?.status?.statusCategory?.key,
          type: f.parent.fields?.issuetype?.name,
        }
      : null,
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

/** Description and the latest comments, for the Jira side panel */
export async function getIssueDetail(cfg: JiraConfig, key: string, maxComments = 10): Promise<JiraIssueDetail> {
  const [issue, comments] = await Promise.all([
    request<{ fields: { description?: AdfDoc | null } }>(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`),
    request<{ total: number; comments: any[] }>(
      cfg,
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=${maxComments}`,
    ),
  ])
  return {
    key,
    description: issue.fields.description ?? null,
    commentTotal: comments.total ?? comments.comments.length,
    comments: comments.comments
      .map((c) => ({
        id: String(c.id),
        author: c.author?.displayName ?? 'Unknown',
        avatarUrl: c.author?.avatarUrls?.['48x48'] ?? null,
        created: c.created,
        body: c.body as AdfDoc,
      }))
      .reverse(), // oldest of the latest first, like a conversation
  }
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

/** Fields set elsewhere (draft, settings) or by Jira itself; everything else that's required is asked for. */
const HANDLED_FIELDS = new Set(['project', 'issuetype', 'summary', 'description', 'reporter', 'assignee', 'labels'])

/** Required fields for creating an issue of this type in this project (Jira create metadata). */
export async function requiredFields(cfg: JiraConfig, projectKey: string, issueType: string): Promise<JiraRequiredField[]> {
  type Page<T> = { issueTypes?: T[]; fields?: T[]; values?: T[] }
  const types = await request<Page<{ id: string; name: string }>>(cfg, `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`)
  const type = (types.issueTypes ?? types.values ?? []).find((t) => t.name.toLowerCase() === issueType.toLowerCase())
  if (!type) throw new JiraError(`Project ${projectKey} has no issue type "${issueType}"`)
  const meta = await request<Page<any>>(cfg, `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${type.id}?maxResults=200`)
  return (meta.fields ?? meta.values ?? [])
    .filter((f) => f.required && !f.hasDefaultValue && !HANDLED_FIELDS.has(f.fieldId))
    .map((f) => ({
      key: f.fieldId,
      name: f.name,
      options: (f.allowedValues ?? []).map((v: any) => ({ id: String(v.id), label: v.value ?? v.name ?? String(v.id) })),
      multiple: f.schema?.type === 'array',
    }))
}

export async function createIssue(
  cfg: JiraConfig,
  input: { projectKey: string; issueType: string; summary: string; description: string; labels?: string[]; fields?: Record<string, unknown> },
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
    // Per-issue values (e.g. required fields picked in the dialog) win over the settings defaults
    ...input.fields,
  }
  if (cfg.create?.assignToMe) fields.assignee = { accountId: (await jiraMyself(cfg)).accountId }
  const r = await request<{ key: string }>(cfg, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) })
  return { key: r.key, url: `${base(cfg)}/browse/${r.key}` }
}
