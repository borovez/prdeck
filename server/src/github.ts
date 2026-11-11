import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckState, GithubAccount, PrRecord } from '../../shared/types.ts'
import { prId } from './refs.ts'

const API = 'https://api.github.com'

export class GithubError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

/** Set when GitHub rate-limits us; no requests go out until then (per process). */
let coolDownUntil = 0
export const githubCoolDown = () => (coolDownUntil > Date.now() ? new Date(coolDownUntil) : null)

async function request<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  if (coolDownUntil > Date.now())
    throw new GithubError(`GitHub rate limit: paused until ${new Date(coolDownUntil).toLocaleTimeString()}`, 429)
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'prdeck',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  // GitHub's GraphQL search occasionally 502s on heavy pages – back off and retry
  if (res.status >= 500 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return request<T>(token, path, init, attempt + 1)
  }
  // Primary or secondary rate limit: wait as long as GitHub says (retry-after / reset), default 5 min
  if ((res.status === 403 || res.status === 429) && (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429)) {
    const retryAfter = Number(res.headers.get('retry-after'))
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    coolDownUntil = retryAfter ? Date.now() + retryAfter * 1000 : reset ? reset * 1000 : Date.now() + 5 * 60_000
    throw new GithubError(`GitHub rate limit: paused until ${new Date(coolDownUntil).toLocaleTimeString()}`, res.status)
  }
  if (!res.ok) {
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (res.status === 403 && /secondary rate limit/i.test(text)) {
      coolDownUntil = Date.now() + 5 * 60_000
      throw new GithubError(`GitHub secondary rate limit: paused until ${new Date(coolDownUntil).toLocaleTimeString()}`, 403)
    }
    throw new GithubError(`GitHub ${res.status} ${path}: ${text.slice(0, 300)}`, res.status)
  }
  // Large GraphQL pages are occasionally cut off mid-body; treat that like a 5xx and retry
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch (e) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      return request<T>(token, path, init, attempt + 1)
    }
    throw new GithubError(`GitHub ${path}: truncated response (${text.length} bytes): ${(e as Error).message}`)
  }
}

export async function graphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const json = await request<{ data?: T; errors?: { message: string; type?: string }[] }>(token, '/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  })
  // Partial results (e.g. a deleted PR in an aliased batch) still come back in data.
  if (json.errors?.length && !json.data) throw new GithubError(json.errors.map((e) => e.message).join('; '))
  if (json.errors?.length) console.warn('[github] partial errors:', json.errors.map((e) => e.message).join('; '))
  return json.data as T
}

/** Token from the GitHub CLI, if installed and logged in. */
export async function ghCliToken(): Promise<string> {
  const { stdout } = await promisify(execFile)('gh', ['auth', 'token'], { timeout: 10_000 })
  const token = stdout.trim()
  if (!token) throw new Error('`gh auth token` returned nothing – run `gh auth login` first')
  return token
}

export async function whoAmI(token: string) {
  const data = await graphql<{
    viewer: { login: string; avatarUrl: string; organizations: { nodes: { login: string }[] } }
  }>(token, `query { viewer { login avatarUrl organizations(first: 100) { nodes { login } } } }`)
  return {
    login: data.viewer.login,
    avatarUrl: data.viewer.avatarUrl,
    orgs: data.viewer.organizations.nodes.map((o) => o.login),
  }
}

export async function listRepos(token: string, owner: string) {
  // Works for both orgs and users
  const data = await graphql<{
    repositoryOwner: { repositories: { nodes: { nameWithOwner: string; isArchived: boolean; pushedAt: string }[] } } | null
  }>(
    token,
    `query($owner: String!) { repositoryOwner(login: $owner) {
       repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) { nodes { nameWithOwner isArchived pushedAt } }
     } }`,
    { owner },
  )
  return (data.repositoryOwner?.repositories.nodes ?? []).filter((r) => !r.isArchived)
}

// ---------- PR fetching ----------

const PR_FRAGMENT = `
fragment PR on PullRequest {
  id number title url state isDraft body createdAt updatedAt mergedAt closedAt
  additions deletions changedFiles headRefName baseRefName mergeable reviewDecision
  mergeCommit { oid }
  author { login avatarUrl }
  repository { nameWithOwner owner { login } defaultBranchRef { name } }
  labels(first: 10) { nodes { name color } }
  assignees(first: 5) { nodes { login avatarUrl } }
  reviewRequests(first: 15) { nodes { requestedReviewer {
    ... on User { login avatarUrl }
    ... on Team { slug }
  } } }
  latestReviews(first: 15) { nodes { state submittedAt author { login avatarUrl } } }
  comments { totalCount }
  reviewThreads(first: 60) { nodes {
    isResolved isOutdated path line
    first: comments(first: 1) { totalCount nodes { url bodyText createdAt author { login avatarUrl } } }
    last: comments(last: 1) { nodes { createdAt author { login } } }
  } }
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts(first: 60) { totalCount nodes {
      __typename
      ... on CheckRun { name conclusion status detailsUrl }
      ... on StatusContext { context state targetUrl }
    } }
  } } } }
}`

type GqlPr = any // shape of PR_FRAGMENT – mapped immediately below

const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function mapPr(n: GqlPr, accountId: string): PrRecord {
  const repo: string = n.repository.nameWithOwner
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup
  const contexts: any[] = rollup?.contexts?.nodes ?? []
  const failing = contexts
    .filter((c) => (c.__typename === 'CheckRun' ? FAILING.has(c.conclusion) : FAILING.has(c.state)))
    .map((c) => ({ name: c.name ?? c.context, url: c.detailsUrl ?? c.targetUrl ?? null }))
  return {
    id: prId(repo, n.number),
    nodeId: n.id,
    owner: n.repository.owner.login,
    repo,
    number: n.number,
    title: n.title,
    url: n.url,
    state: n.state,
    isDraft: n.isDraft,
    body: n.body ?? '',
    author: { login: n.author?.login ?? 'ghost', avatarUrl: n.author?.avatarUrl },
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    mergedAt: n.mergedAt,
    closedAt: n.closedAt,
    headRef: n.headRefName,
    baseRef: n.baseRefName,
    defaultBranch: n.repository.defaultBranchRef?.name ?? null,
    mergeCommitSha: n.mergeCommit?.oid ?? null,
    additions: n.additions,
    deletions: n.deletions,
    changedFiles: n.changedFiles,
    mergeable: n.mergeable,
    reviewDecision: n.reviewDecision,
    labels: n.labels.nodes,
    assignees: n.assignees.nodes,
    requestedReviewers: n.reviewRequests.nodes
      .map((r: any) => r.requestedReviewer)
      .filter(Boolean)
      .map((r: any) => (r.slug ? { login: r.slug, isTeam: true } : { login: r.login, avatarUrl: r.avatarUrl, isTeam: false })),
    reviews: n.latestReviews.nodes.map((r: any) => ({
      login: r.author?.login ?? 'ghost',
      avatarUrl: r.author?.avatarUrl,
      state: r.state,
      submittedAt: r.submittedAt,
    })),
    comments: n.comments.totalCount,
    unresolvedThreads: n.reviewThreads.nodes.filter((t: any) => !t.isResolved).length,
    threads: n.reviewThreads.nodes
      .filter((t: any) => !t.isResolved && t.first.nodes[0])
      .map((t: any) => {
        const c = t.first.nodes[0]
        const last = t.last.nodes[0]
        const body: string = c.bodyText ?? ''
        return {
          url: c.url,
          path: t.path,
          line: t.line ?? null,
          outdated: !!t.isOutdated,
          author: { login: c.author?.login ?? 'ghost', avatarUrl: c.author?.avatarUrl },
          body: body.length > 400 ? `${body.slice(0, 400)}…` : body,
          createdAt: c.createdAt,
          comments: t.first.totalCount,
          lastAuthor: last?.author?.login ?? null,
          lastAt: last?.createdAt ?? null,
        }
      }),
    checks: {
      state: (rollup?.state as CheckState) ?? 'NONE',
      total: rollup?.contexts?.totalCount ?? 0,
      failing,
    },
    accountId,
  }
}

/** Runs a GitHub issue-search query (must include is:pr) and returns every page (capped). */
export async function searchPrs(account: GithubAccount, q: string, max = 300): Promise<PrRecord[]> {
  const out: PrRecord[] = []
  let after: string | null = null
  while (out.length < max) {
    const data: any = await graphql(
      account.token,
      `${PR_FRAGMENT}
       query($q: String!, $after: String) {
         search(query: $q, type: ISSUE, first: 15, after: $after) {
           pageInfo { hasNextPage endCursor }
           nodes { ... on PullRequest { ...PR } }
         }
       }`,
      { q, after },
    )
    for (const n of data.search.nodes) if (n?.number) out.push(mapPr(n, account.id))
    if (!data.search.pageInfo.hasNextPage) break
    after = data.search.pageInfo.endCursor
  }
  return out
}

/** Fetch specific PRs by id in one aliased query (used for dependency targets). */
export async function fetchPrsByRef(
  account: GithubAccount,
  refs: { owner: string; name: string; number: number }[],
): Promise<PrRecord[]> {
  if (!refs.length) return []
  const out: PrRecord[] = []
  for (let i = 0; i < refs.length; i += 20) {
    const chunk = refs.slice(i, i + 20)
    const body = chunk
      .map(
        (r, j) =>
          `p${j}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) { pullRequest(number: ${r.number}) { ...PR } }`,
      )
      .join('\n')
    const data: any = await graphql(account.token, `${PR_FRAGMENT}\nquery { ${body} }`)
    for (let j = 0; j < chunk.length; j++) {
      const n = data?.[`p${j}`]?.pullRequest
      if (n) out.push(mapPr(n, account.id))
    }
  }
  return out
}

// ---------- Release detection ----------

/** Resolve the ref that represents "released" for a repo: latest release tag (or newest tag), or a branch. */
export async function resolveReleaseRef(account: GithubAccount, repo: string, configured: string): Promise<string | null> {
  if (configured && configured !== 'latest-release') return configured
  const [owner, name] = repo.split('/')
  const data: any = await graphql(
    account.token,
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
       latestRelease { tagName }
       refs(refPrefix: "refs/tags/", first: 1, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) { nodes { name } }
     } }`,
    { owner, name },
  )
  return data.repository?.latestRelease?.tagName ?? data.repository?.refs?.nodes?.[0]?.name ?? null
}

/** Is `sha` contained in `ref`? */
export async function isCommitIn(account: GithubAccount, repo: string, sha: string, ref: string): Promise<boolean> {
  const cmp = await request<{ status: 'ahead' | 'behind' | 'identical' | 'diverged' }>(
    account.token,
    `/repos/${repo}/compare/${encodeURIComponent(sha)}...${encodeURIComponent(ref)}?per_page=1`,
  )
  return cmp.status === 'ahead' || cmp.status === 'identical'
}
