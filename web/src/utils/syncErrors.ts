/**
 * Sync errors arrive as plain strings like
 *   [borovez (gh CLI)] search "is:pr is:open repo:a/b repo:c/d": API rate limit already exceeded…
 *   [slack] Slack stars.list: missing_scope (needs scope stars:read)
 * This splits them into source, what was being done, a plain summary and a hint.
 */
export interface SyncError {
  raw: string
  source: string
  kind: 'github' | 'jira' | 'slack' | 'other'
  /** What was being done: "Search", "Dependency fetch", "Slack stars.list"… */
  context: string
  /** Repos named in a search query, shown as chips */
  repos: string[]
  /** Other search qualifiers (is:open, author:@me…) */
  query: string | null
  summary: string
  hint: string | null
  message: string
}

const KNOWN: [RegExp, string, string | null][] = [
  // Most specific first
  [/secondary rate limit/i, 'GitHub asked to slow down', 'Calls pause for a few minutes, then sync resumes.'],
  [/rate limit/i, 'GitHub rate limit reached', 'PR Deck pauses GitHub calls until the limit resets (usually within the hour) and retries on its own.'],
  [/missing_scope|needs scope/i, 'Missing permission', 'Add the scope to your Slack app, reinstall it and paste the new token in Settings → Slack.'],
  [/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i, 'Network error', 'Usually temporary; the next sync tries again.'],
  [/401|bad credentials|invalid_auth|token_revoked/i, 'Token rejected', 'Reconnect the account in Settings.'],
  [/truncated response/i, 'GitHub cut a response short', 'Retried automatically; the next sync usually succeeds.'],
  [/channel_not_found|not_in_channel/i, 'A conversation can’t be read', null],
]

export function parseSyncError(raw: string): SyncError {
  const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(raw)
  const source = m?.[1] ?? 'Sync'
  let rest = m?.[2] ?? raw
  const kind: SyncError['kind'] = /slack/i.test(source) ? 'slack' : /jira/i.test(source) ? 'jira' : m ? 'github' : 'other'

  let context = ''
  let repos: string[] = []
  let query: string | null = null
  const search = /^search "([^"]*)":\s*([\s\S]*)$/.exec(rest)
  if (search) {
    context = 'PR search'
    repos = [...search[1].matchAll(/repo:(\S+)/g)].map((r) => r[1])
    query = search[1].replace(/repo:\S+/g, '').replace(/\s+/g, ' ').trim() || null
    rest = search[2]
  } else {
    const ctx = /^([^:]{3,60}):\s+([\s\S]*)$/.exec(rest)
    if (ctx) [context, rest] = [ctx[1].charAt(0).toUpperCase() + ctx[1].slice(1), ctx[2]]
  }
  const known = KNOWN.find(([re]) => re.test(raw))
  return {
    raw,
    source: kind === 'slack' ? 'Slack' : kind === 'jira' ? 'Jira' : source,
    kind,
    context,
    repos,
    query,
    summary: known?.[1] ?? rest.split(/[.\n]/)[0].slice(0, 120),
    hint: known?.[2] ?? null,
    message: rest.trim(),
  }
}
