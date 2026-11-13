import { adfToMarkdown, markdownToAdf, type AdfDoc } from '../../shared/adf.ts'
import type {
  JiraConfig,
  JiraCreateMeta,
  JiraEditable,
  JiraFieldKind,
  JiraFieldMeta,
  JiraFieldOption,
  JiraFieldValue,
  JiraIssue,
  JiraIssueDetail,
  JiraIssueTypeMeta,
  JiraLink,
  JiraProjectMeta,
  JiraRequiredField,
  JiraValueLabels,
  JiraWriteInput,
} from '../../shared/types.ts'

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
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    issuetype: { name: input.issueType },
    summary: input.summary.slice(0, 254),
    description: markdownToAdf(input.description),
    ...(input.labels?.length ? { labels: input.labels.map((l) => l.replace(/\s+/g, '-')) } : {}),
    ...input.fields,
  }
  if (cfg.create?.assignToMe) fields.assignee = { accountId: (await jiraMyself(cfg)).accountId }
  const r = await request<{ key: string }>(cfg, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) })
  return { key: r.key, url: `${base(cfg)}/browse/${r.key}` }
}

// ---------- Composer: metadata, field values, create and edit ----------

/** Set by the composer's own controls, or not editable as a property */
const COMPOSER_SKIP = new Set([
  'summary',
  'description',
  'issuetype',
  'project',
  'reporter',
  'attachment',
  'issuelinks',
  'comment',
  'timetracking',
  'worklog',
  'watches',
  'votes',
  'resolution',
  'security',
  'thumbnail',
])

/** How the composer edits a field, from its schema; null for types it doesn't support */
function kindOf(key: string, schema: any, hasOptions: boolean): JiraFieldKind | null {
  const t: string = schema?.type ?? ''
  const items: string = schema?.items ?? ''
  const system: string = schema?.system ?? ''
  const custom: string = schema?.custom ?? ''
  if (COMPOSER_SKIP.has(system) || COMPOSER_SKIP.has(key)) return null
  if (system === 'parent' || key === 'parent') return 'parent'
  if (custom.endsWith(':gh-sprint')) return 'sprint'
  if (system === 'labels' || custom.endsWith(':labels')) return 'labels'
  if (t === 'user') return 'user'
  if (t === 'array' && items === 'user') return 'users'
  if (['priority', 'option', 'version', 'component', 'option-with-child'].includes(t)) return hasOptions ? 'option' : null
  if (t === 'array' && ['option', 'version', 'component'].includes(items)) return hasOptions ? 'options' : null
  if (t === 'number') return 'number'
  if (t === 'date' || t === 'datetime') return 'date'
  if (t === 'string') return custom.endsWith(':textarea') || system === 'environment' ? 'text' : 'string'
  return null
}

/** One createmeta / editmeta field entry → composer field (null if unsupported) */
function toFieldMeta(key: string, f: any): JiraFieldMeta | null {
  const options: JiraFieldOption[] = (f.allowedValues ?? []).map((v: any) => ({
    id: String(v.id),
    label: v.value ?? v.name ?? String(v.id),
    iconUrl: v.iconUrl ?? null,
    ...(v.released === false ? { detail: 'Unreleased' } : {}),
  }))
  const kind = kindOf(key, f.schema, options.length > 0)
  if (!kind) return null
  return { key, name: f.name ?? key, kind, required: !!f.required, options, custom: f.schema?.custom, schemaType: f.schema?.type }
}

const metaCache = new Map<string, { at: number; value: Promise<unknown> }>()
function cached<T>(key: string, load: () => Promise<T>, ttlMs = 10 * 60_000): Promise<T> {
  const hit = metaCache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load()
  metaCache.set(key, { at: Date.now(), value })
  value.catch(() => metaCache.delete(key))
  return value
}

/**
 * Projects I can create issues in. Settings → Jira picks which ones PR Deck uses (`projectKeys`);
 * everything else gets only those, unless none are picked. `all` is for that picker.
 */
export async function listProjects(cfg: JiraConfig, { all = false } = {}): Promise<JiraProjectMeta[]> {
  const every = await allProjects(cfg)
  const chosen = new Set(cfg.projectKeys.map((k) => k.toUpperCase()))
  return all || !chosen.size ? every : every.filter((p) => chosen.has(p.key))
}

function allProjects(cfg: JiraConfig): Promise<JiraProjectMeta[]> {
  return cached(`projects:${cfg.baseUrl}:${cfg.email}`, async () => {
    const out: JiraProjectMeta[] = []
    for (let startAt = 0; ; startAt += 50) {
      const page = await request<{ values: any[]; isLast?: boolean }>(cfg, `/rest/api/3/project/search?action=create&orderBy=name&maxResults=50&startAt=${startAt}`)
      out.push(...page.values.map((p) => ({ key: p.key, name: p.name, avatarUrl: p.avatarUrls?.['24x24'] ?? null })))
      if (page.isLast !== false || !page.values.length) break
    }
    return out
  })
}

/** Standard (non sub-task) issue types of a project, for Settings' default type */
export async function projectIssueTypes(cfg: JiraConfig, projectKey: string): Promise<JiraIssueTypeMeta[]> {
  return (await issueTypesFor(cfg, projectKey)).filter((t) => !t.subtask)
}

async function issueTypesFor(cfg: JiraConfig, projectKey: string): Promise<JiraIssueTypeMeta[]> {
  return cached(`types:${cfg.baseUrl}:${projectKey}`, async () => {
    type Page = { issueTypes?: any[]; values?: any[] }
    const r = await request<Page>(cfg, `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`)
    return (r.issueTypes ?? r.values ?? []).map((t) => ({ id: String(t.id), name: t.name, iconUrl: t.iconUrl ?? null, subtask: !!t.subtask }))
  })
}

/** Fields for creating an issue of this type in this project; the type defaults to Settings → Jira, else the first standard type */
export async function createMeta(cfg: JiraConfig, projectKey: string, issueTypeId?: string): Promise<JiraCreateMeta> {
  const [projects, issueTypes] = await Promise.all([allProjects(cfg).catch(() => []), issueTypesFor(cfg, projectKey)])
  const standard = issueTypes.filter((t) => !t.subtask)
  const type =
    issueTypes.find((t) => t.id === issueTypeId) ??
    standard.find((t) => t.name.toLowerCase() === (cfg.create?.issueType || 'task').toLowerCase()) ??
    standard[0] ??
    issueTypes[0]
  if (!type) throw new JiraError(`Can't create issues in ${projectKey}`)
  const fields = await cached(`fields:${projectKey}:${type.id}`, async () => {
    type Page = { fields?: any[]; values?: any[] }
    const r = await request<Page>(cfg, `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${type.id}?maxResults=200`)
    return (r.fields ?? r.values ?? []).map((f) => toFieldMeta(f.fieldId ?? f.key, f)).filter((f): f is JiraFieldMeta => !!f)
  })
  const project = projects.find((p) => p.key === projectKey) ?? { key: projectKey, name: projectKey, avatarUrl: null }
  // Settings → Jira: assign to me
  const defaults: Record<string, JiraFieldValue> = {}
  const labels: JiraValueLabels = {}
  if (cfg.create?.assignToMe && fields.some((f) => f.key === 'assignee')) {
    const me = await cached(`me:${cfg.baseUrl}`, () => request<any>(cfg, '/rest/api/3/myself')).catch(() => null)
    if (me) {
      defaults.assignee = me.accountId
      labels.assignee = { [me.accountId]: { id: me.accountId, label: me.displayName, iconUrl: me.avatarUrls?.['24x24'] ?? null } }
    }
  }
  return { project, issueTypes, issueTypeId: type.id, fields, defaults, labels }
}

/** A field's current value in composer form, and labels for values not in its options */
function fromJira(meta: JiraFieldMeta, raw: any): { value: JiraFieldValue; labels?: Record<string, JiraFieldOption> } {
  if (raw === null || raw === undefined) return { value: meta.kind === 'options' || meta.kind === 'users' || meta.kind === 'labels' ? [] : null }
  switch (meta.kind) {
    case 'option':
      return { value: String(raw.id) }
    case 'options':
      return { value: raw.map((x: any) => String(x.id)) }
    case 'user':
      return { value: raw.accountId, labels: { [raw.accountId]: { id: raw.accountId, label: raw.displayName, iconUrl: raw.avatarUrls?.['24x24'] } } }
    case 'users':
      return {
        value: raw.map((u: any) => u.accountId),
        labels: Object.fromEntries(raw.map((u: any) => [u.accountId, { id: u.accountId, label: u.displayName, iconUrl: u.avatarUrls?.['24x24'] }])),
      }
    case 'labels':
      return { value: raw }
    case 'parent':
      return { value: raw.key, labels: { [raw.key]: { id: raw.key, label: raw.fields?.summary ?? raw.key, iconUrl: raw.fields?.issuetype?.iconUrl, detail: raw.fields?.status?.name } } }
    case 'sprint': {
      const list: any[] = Array.isArray(raw) ? raw : [raw]
      const s = list.find((x) => x.state === 'active') ?? list.find((x) => x.state === 'future') ?? list.at(-1)
      return s ? { value: String(s.id), labels: { [String(s.id)]: { id: String(s.id), label: s.name, detail: s.state } } } : { value: null }
    }
    case 'number':
      return { value: Number(raw) }
    case 'text':
      return { value: typeof raw === 'string' ? raw : adfToMarkdown(raw) }
    case 'date':
      return { value: String(raw).slice(0, 10) }
    default:
      return { value: String(raw) }
  }
}

/** Composer values → Jira's field payload */
function toJiraFields(fields: JiraFieldMeta[], values: Record<string, JiraFieldValue>): Record<string, unknown> {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(values)) {
    const meta = byKey.get(key)
    if (!meta) continue
    const list = Array.isArray(v) ? v : v === null || v === '' ? [] : [String(v)]
    const one = list[0] ?? null
    switch (meta.kind) {
      case 'option':
        out[key] = one ? { id: one } : null
        break
      case 'options':
        out[key] = list.map((id) => ({ id }))
        break
      case 'user':
        out[key] = one ? { accountId: one } : null
        break
      case 'users':
        out[key] = list.map((accountId) => ({ accountId }))
        break
      case 'labels':
        out[key] = list.map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean)
        break
      case 'parent':
        out[key] = one ? { key: one } : null
        break
      case 'sprint':
        out[key] = one ? Number(one) : null
        break
      case 'number':
        out[key] = v === null || v === '' ? null : Number(v)
        break
      case 'text':
        out[key] = typeof v === 'string' && v.trim() ? markdownToAdf(v) : null
        break
      case 'date':
        out[key] = one ? (meta.schemaType === 'datetime' ? `${one}T00:00:00.000+0000` : one) : null
        break
      default:
        out[key] = one
    }
  }
  return out
}

/** An issue with its editable fields and current values, for the composer's Edit mode */
export async function editable(cfg: JiraConfig, key: string): Promise<JiraEditable> {
  const raw = await request<any>(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}?expand=editmeta&fields=*all`)
  const metaFields: Record<string, any> = raw.editmeta?.fields ?? {}
  const fields = Object.entries(metaFields)
    .map(([k, f]) => toFieldMeta(k, f))
    .filter((f): f is JiraFieldMeta => !!f)
  const values: Record<string, JiraFieldValue> = {}
  const labels: JiraValueLabels = {}
  for (const f of fields) {
    const r = fromJira(f, raw.fields?.[f.key])
    values[f.key] = r.value
    if (r.labels) labels[f.key] = r.labels
  }
  const projectKey: string = raw.fields?.project?.key ?? key.split('-')[0]
  // Types it can switch to (same workflow), else the project's types
  const allowed: any[] = metaFields.issuetype?.allowedValues ?? []
  const issueTypes = allowed.length
    ? allowed.map((t) => ({ id: String(t.id), name: t.name, iconUrl: t.iconUrl ?? null, subtask: !!t.subtask }))
    : await issueTypesFor(cfg, projectKey).catch(() => [])
  return {
    key: raw.key,
    url: `${base(cfg)}/browse/${raw.key}`,
    project: { key: projectKey, name: raw.fields?.project?.name ?? projectKey, avatarUrl: raw.fields?.project?.avatarUrls?.['24x24'] ?? null },
    issueTypeId: String(raw.fields?.issuetype?.id ?? ''),
    issueTypes,
    summary: raw.fields?.summary ?? '',
    description: adfToMarkdown(raw.fields?.description),
    fields,
    values,
    labels,
  }
}

/** Choices searched on the fly: assignable users, parents (epics), sprints of the project's board, labels */
export async function fieldOptions(
  cfg: JiraConfig,
  kind: JiraFieldKind,
  { project, q = '', issueKey, field }: { project: string; q?: string; issueKey?: string; field?: string },
): Promise<JiraFieldOption[]> {
  const query = q.trim()
  if (kind === 'user' || kind === 'users') {
    const scope = issueKey ? `issueKey=${encodeURIComponent(issueKey)}` : `project=${encodeURIComponent(project)}`
    const users = await request<any[]>(cfg, `/rest/api/3/user/assignable/search?${scope}&query=${encodeURIComponent(query)}&maxResults=20`)
    return users.map((u) => ({ id: u.accountId, label: u.displayName, iconUrl: u.avatarUrls?.['24x24'] ?? null }))
  }
  if (kind === 'parent') {
    const text = query ? (/^[A-Z][A-Z0-9_]+-\d+$/i.test(query) ? ` AND key = "${query.toUpperCase()}"` : ` AND summary ~ "${query.replace(/["\\]/g, '')}*"`) : ''
    const jql = `project = "${project}" AND issuetype = Epic AND statusCategory != Done${text} ORDER BY updated DESC`
    const r = await request<{ issues: any[] }>(cfg, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, fields: ['summary', 'status', 'issuetype'], maxResults: 30 }),
    })
    return r.issues.map((i) => ({ id: i.key, label: i.fields.summary, iconUrl: i.fields.issuetype?.iconUrl, detail: `${i.key} · ${i.fields.status?.name ?? ''}` }))
  }
  if (kind === 'sprint') {
    const sprints = await cached(`sprints:${project}`, async () => {
      const boards = await request<{ values: any[] }>(cfg, `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}&type=scrum&maxResults=10`)
      const out: JiraFieldOption[] = []
      for (const b of boards.values.slice(0, 3)) {
        const r = await request<{ values: any[] }>(cfg, `/rest/agile/1.0/board/${b.id}/sprint?state=active,future&maxResults=50`).catch(() => ({ values: [] }))
        for (const s of r.values) if (!out.some((o) => o.id === String(s.id))) out.push({ id: String(s.id), label: s.name, detail: s.state === 'active' ? 'Active' : 'Future' })
      }
      return out
    }, 5 * 60_000)
    return sprints.filter((s) => !query || s.label.toLowerCase().includes(query.toLowerCase()))
  }
  if (kind === 'labels') {
    // Custom label fields are named cf[12345] in JQL
    const name = field?.startsWith('customfield_') ? `cf[${field.slice('customfield_'.length)}]` : 'labels'
    const r = await request<{ results: { value: string }[] }>(
      cfg,
      `/rest/api/3/jql/autocompletedata/suggestions?fieldName=${encodeURIComponent(name)}&fieldValue=${encodeURIComponent(query)}`,
    )
    return r.results.map((x) => ({ id: x.value, label: x.value }))
  }
  return []
}

/** Upload files to an issue (images pasted into the composer) */
export async function addAttachments(
  cfg: JiraConfig,
  key: string,
  files: { name: string; type: string; data: string }[],
): Promise<{ filename: string; content: string }[]> {
  if (!files.length) return []
  const form = new FormData()
  for (const f of files) form.append('file', new Blob([Buffer.from(f.data, 'base64')], { type: f.type }), f.name)
  const res = await fetch(`${base(cfg)}/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64'),
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
    body: form,
  })
  if (!res.ok) throw new JiraError(`Jira ${res.status} attachments: ${(await res.text()).slice(0, 300)}`, res.status)
  return ((await res.json()) as { filename: string; content: string }[]).map((a) => ({ filename: a.filename, content: a.content }))
}

const ATTACHMENT_REF = /!\[([^\]]*)\]\(attachment:([^)\s]+)\)/g
/** Whether a Markdown description refers to images pasted in the composer */
export const hasAttachmentRefs = (md: string) => /\]\(attachment:/.test(md)
/**
 * attachment:name images → the uploaded attachment's URL (Jira shows it inline to anyone who can see
 * the issue); images that weren't uploaded are dropped.
 */
export function resolveAttachmentRefs(md: string, uploaded: { filename: string; content: string }[]) {
  return md
    .replace(ATTACHMENT_REF, (_, alt: string, name: string) => {
      const file = uploaded.find((u) => u.filename === decodeURIComponent(name))
      return file ? `![${alt}](${file.content})` : ''
    })
    .replace(/\n{3,}/g, '\n\n')
}

/** Add a comment (Markdown) to an issue */
export async function addComment(cfg: JiraConfig, key: string, markdown: string) {
  await request(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', body: JSON.stringify({ body: markdownToAdf(markdown) }) })
}

/** Fetch one issue in the list shape (to refresh the cache after a write) */
export async function getIssue(cfg: JiraConfig, key: string): Promise<JiraIssue> {
  const raw = await request<any>(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`)
  return mapIssue(cfg, raw, false)
}

/** Create from the composer: exactly the fields it sends (defaults are filled in the composer, not here) */
export async function composeCreate(cfg: JiraConfig, input: JiraWriteInput): Promise<JiraIssue> {
  const meta = await createMeta(cfg, input.projectKey, input.issueTypeId)
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    issuetype: { id: meta.issueTypeId },
    summary: input.summary.slice(0, 254),
    ...(input.description.trim() ? { description: markdownToAdf(input.description) } : {}),
    ...toJiraFields(meta.fields, input.values),
  }
  // Empty values aren't sent on create
  for (const [k, v] of Object.entries(fields)) if (v === null || (Array.isArray(v) && !v.length)) delete fields[k]
  const r = await request<{ key: string }>(cfg, '/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) })
  return getIssue(cfg, r.key)
}

/** Edit from the composer: only the fields given (the composer sends what changed) */
export async function composeUpdate(
  cfg: JiraConfig,
  key: string,
  changes: { summary?: string; description?: string; issueTypeId?: string; values?: Record<string, JiraFieldValue> },
): Promise<JiraIssue> {
  const meta = await editable(cfg, key)
  const fields: Record<string, unknown> = {
    ...(changes.summary !== undefined ? { summary: changes.summary.slice(0, 254) } : {}),
    ...(changes.description !== undefined ? { description: changes.description.trim() ? markdownToAdf(changes.description) : null } : {}),
    ...(changes.issueTypeId ? { issuetype: { id: changes.issueTypeId } } : {}),
    ...toJiraFields(meta.fields, changes.values ?? {}),
  }
  if (Object.keys(fields).length) await request(cfg, `/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields }) })
  return getIssue(cfg, key)
}
