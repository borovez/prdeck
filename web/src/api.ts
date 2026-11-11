import type { AiConfig, JiraDraft, JiraRequiredField, Overview, Settings, SlackStatus } from '@shared/types'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status} ${res.statusText}`)
  return json as T
}

export const api = {
  overview: () => call<Overview>('GET', '/overview'),
  sync: () => call<Overview>('POST', '/sync'),
  setAutoSync: (enabled: boolean) => call<{ enabled: boolean }>('PUT', '/sync/auto', { enabled }),
  settings: () => call<Settings>('GET', '/settings'),
  saveSettings: (s: Settings) => call<Settings>('PUT', '/settings', s),
  testGithub: (token: string, accountId?: string) =>
    call<{ login: string; avatarUrl: string; orgs: string[] }>('POST', '/setup/github/test', { token, accountId }),
  importGhCli: () => call<{ login: string; orgs: string[]; settings: Settings }>('POST', '/setup/github/gh-cli'),
  owners: (accountId: string) => call<string[]>('GET', `/setup/github/${accountId}/owners`),
  repos: (accountId: string, owner: string) =>
    call<{ nameWithOwner: string; pushedAt: string }[]>('GET', `/setup/github/${accountId}/repos?owner=${encodeURIComponent(owner)}`),
  testJira: (baseUrl: string, email: string, apiToken: string) =>
    call<{ displayName: string; accountId: string }>('POST', '/setup/jira/test', { baseUrl, email, apiToken }),
  aiInfo: () => call<{ env: boolean; claudeCode: string | null }>('GET', '/setup/ai'),
  testAi: (ai: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>) =>
    call<{ model: string; source: 'key' | 'environment' | 'claude-code' }>('POST', '/setup/ai/test', ai),
  mcpInfo: () => call<{ node: string; entry: string; dbPath: string; tsxCandidates: string[] }>('GET', '/setup/mcp'),
  addDep: (from: string, to: string, kind: 'merge' | 'release', note?: string) =>
    call<{ id: number }>('POST', '/deps', { from, to, kind, note }),
  removeDep: (id: number) => call('DELETE', `/deps/${id}`),
  setMeta: (id: string, note: string | null, pinned: boolean) => call('PUT', '/prs/meta', { id, note, pinned }),
  jiraRequiredFields: (project: string, type: string) =>
    call<JiraRequiredField[]>('GET', `/jira/required-fields?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`),
  transitions: (key: string) =>
    call<{ id: string; name: string; to: string; toCategory: string }[]>('GET', `/jira/${key}/transitions`),
  transition: (key: string, id: string) => call('POST', `/jira/${key}/transitions`, { id }),
  testSlack: (token: string) => call<{ userId: string; user: string; team: string; url: string }>('POST', '/setup/slack/test', { token }),
  slackStatus: (id: string, status: SlackStatus) => call('PUT', `/slack/${encodeURIComponent(id)}/status`, { status }),
  slackDraft: (id: string, context: string, projectKey?: string) =>
    call<{ draft: JiraDraft; thread: string }>('POST', `/slack/${encodeURIComponent(id)}/draft`, { context, projectKey }),
  createJira: (input: {
    projectKey: string
    issueType: string
    summary: string
    description: string
    labels: string[]
    slackItemId?: string | null
    replyInThread?: boolean
    fields?: Record<string, unknown>
  }) => call<{ key: string; url: string; replied: boolean }>('POST', '/jira/create', input),
}
