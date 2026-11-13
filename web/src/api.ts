import type { AiConfig, ImageAttachment, JiraAiDraft, JiraDraftRequest, RepoCatalog, JiraIssueTypeMeta, JiraCreateMeta, JiraEditable, JiraFieldKind, JiraFieldOption, JiraIssue, JiraProjectMeta, JiraWriteInput, JiraFieldValue, JiraIssueDetail, PrDetail, Overview, Settings, SlackContext, SlackStatus, SyncState } from '@shared/types'

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status} ${res.statusText}`)
  return json as T
}

export const api = {
  overview: () => call<Overview>('GET', '/overview'),
  sync: () => call<Overview>('POST', '/sync'),
  syncStatus: () => call<SyncState>('GET', '/sync/status'),
  setAutoSync: (enabled: boolean) => call<{ enabled: boolean }>('PUT', '/sync/auto', { enabled }),
  settings: () => call<Settings>('GET', '/settings'),
  saveSettings: (s: Settings) => call<Settings>('PUT', '/settings', s),
  testGithub: (token: string, accountId?: string) =>
    call<{ login: string; avatarUrl: string; orgs: string[] }>('POST', '/setup/github/test', { token, accountId }),
  importGhCli: () => call<{ login: string; orgs: string[]; settings: Settings }>('POST', '/setup/github/gh-cli'),
  /** Settings form: every Jira project, and a project's issue types, with the credentials being edited */
  jiraAllProjects: (baseUrl: string, email: string, apiToken: string) =>
    call<JiraProjectMeta[]>('POST', '/setup/jira/projects', { baseUrl, email, apiToken }),
  jiraIssueTypes: (baseUrl: string, email: string, apiToken: string, project: string) =>
    call<JiraIssueTypeMeta[]>('POST', '/setup/jira/issue-types', { baseUrl, email, apiToken, project }),
  repoCatalog: (refresh = false) => call<RepoCatalog>('GET', `/setup/github/repo-catalog${refresh ? '?refresh=1' : ''}`),
  testJira: (baseUrl: string, email: string, apiToken: string) =>
    call<{ displayName: string; accountId: string }>('POST', '/setup/jira/test', { baseUrl, email, apiToken }),
  aiInfo: () => call<{ env: boolean; claudeCode: string | null }>('GET', '/setup/ai'),
  testAi: (ai: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>) =>
    call<{ model: string; source: 'key' | 'environment' | 'claude-code' }>('POST', '/setup/ai/test', ai),
  mcpInfo: () => call<{ node: string; entry: string; dbPath: string; tsxCandidates: string[] }>('GET', '/setup/mcp'),
  addDep: (from: string, to: string, kind: 'merge' | 'release', note?: string) =>
    call<{ id?: number; written: boolean; writtenOther?: boolean; error?: string }>('POST', '/deps', { from, to, kind, note }),
  removeDepFromDescription: (from: string, to: string) => call('POST', '/deps/remove-from-description', { from, to }),
  removeDep: (id: number) => call('DELETE', `/deps/${id}`),
  prDetail: (id: string) => call<PrDetail>('GET', `/prs/detail?id=${encodeURIComponent(id)}`),
  resyncPr: (id: string) => call('POST', '/prs/resync', { id }),
  refreshRelease: (id: string) => call('POST', '/releases/refresh', { id }),
  setMeta: (id: string, note: string | null, pinned: boolean) => call('PUT', '/prs/meta', { id, note, pinned }),
  jiraProjects: () => call<JiraProjectMeta[]>('GET', '/jira/projects'),
  jiraMeta: (project: string, type?: string) =>
    call<JiraCreateMeta>('GET', `/jira/meta?project=${encodeURIComponent(project)}${type ? `&type=${encodeURIComponent(type)}` : ''}`),
  jiraOptions: (q: { kind: JiraFieldKind; project: string; q?: string; issue?: string; field?: string }) =>
    call<JiraFieldOption[]>('GET', `/jira/options?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  jiraEditable: (key: string) => call<JiraEditable>('GET', `/jira/${encodeURIComponent(key)}/editable`),
  jiraCreateIssue: (input: JiraWriteInput) => call<JiraIssue & { replied: boolean; attachError: string | null }>('POST', '/jira/issues', input),
  jiraDraft: (input: JiraDraftRequest, signal?: AbortSignal) => call<JiraAiDraft>('POST', '/jira/draft', input, signal),
  jiraUpdateIssue: (key: string, changes: { summary?: string; description?: string; issueTypeId?: string; values?: Record<string, JiraFieldValue>; attachments?: ImageAttachment[]; comment?: string }) =>
    call<JiraIssue>('PUT', `/jira/issues/${encodeURIComponent(key)}`, changes),
  jiraRefresh: (key: string) => call<JiraIssue>('POST', `/jira/${encodeURIComponent(key)}/refresh`),
  jiraDetail: (key: string) => call<JiraIssueDetail>('GET', `/jira/${encodeURIComponent(key)}/detail`),
  transitions: (key: string) =>
    call<{ id: string; name: string; to: string; toCategory: string }[]>('GET', `/jira/${key}/transitions`),
  transition: (key: string, id: string) => call('POST', `/jira/${key}/transitions`, { id }),
  testLaunchDarkly: (cfg: { apiToken: string; baseUrl: string; projectKey: string }) =>
    call<{ project: string; environments: string[] }>('POST', '/setup/launchdarkly/test', cfg),
  testSlack: (token: string) => call<{ userId: string; user: string; team: string; url: string }>('POST', '/setup/slack/test', { token }),
  slackAround: (id: string, before = 2, after = 2) =>
    call<SlackContext>('GET', `/slack/${encodeURIComponent(id)}/around?before=${before}&after=${after}`),
  slackStatus: (id: string, status: SlackStatus) =>
    call<{ ok: boolean; slack: { reaction: string; done: boolean } | null; warning?: string }>('PUT', `/slack/${encodeURIComponent(id)}/status`, { status }),
}
