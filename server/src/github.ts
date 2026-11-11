import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckState, GithubAccount, PrRecord, PrDetail } from '../../shared/types.ts'
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
/** Last x-ratelimit-reset seen (epoch seconds), for limits reported in a GraphQL body */
let lastReset = 0
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
  // Out of quota after this call: stop until the reset instead of failing the next calls one by one
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  if (reset) lastReset = reset
  if (res.headers.get('x-ratelimit-remaining') === '0' && reset) coolDownUntil = Math.max(coolDownUntil, reset * 1000)
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
  // GraphQL reports its rate limit in the body (HTTP 200): pause until the reset like REST limits
  if (json.errors?.some((e) => e.type === 'RATE_LIMITED' || /rate limit/i.test(e.message))) {
    coolDownUntil = Math.max(coolDownUntil, lastReset ? lastReset * 1000 : Date.now() + 5 * 60_000)
    throw new GithubError(`GitHub rate limit: paused until ${new Date(coolDownUntil).toLocaleTimeString()}`, 429)
  }
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
    ... on Bot { login avatarUrl }
    ... on Mannequin { login avatarUrl }
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
      .map((r: any) => (r.slug ? { login: r.slug, isTeam: true } : { login: r.login, avatarUrl: r.avatarUrl, isTeam: false }))
      .filter((r: { login?: string }) => r.login), // a reviewer type we don't select has no login
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

const MAX_FILES = 300
const MAX_PATCH_LINES = 400

/** Rendered description and changed files with diffs, for the PR panel */
export async function prDetail(account: GithubAccount, repo: string, number: number): Promise<PrDetail> {
  const [owner, name] = repo.split('/')
  // Files: 100 per page, next page only when this one was full (usually a single request); 300 max
  const files = async () => {
    const all: any[] = []
    for (let page = 1; page <= 3; page++) {
      const batch = await request<any[]>(account.token, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`)
      all.push(...batch)
      if (batch.length < 100) break
    }
    return all
  }
  const [body, raw] = await Promise.all([
    graphql<{ repository: { pullRequest: { bodyHTML: string } | null } | null }>(
      account.token,
      `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { bodyHTML } } }`,
      { owner, name, number },
    ),
    files(),
  ])
  return {
    bodyHTML: body.repository?.pullRequest?.bodyHTML ?? '',
    filesTruncated: raw.length >= MAX_FILES,
    files: raw.slice(0, MAX_FILES).map((f) => {
      const lines: string[] | null = typeof f.patch === 'string' ? f.patch.split('\n') : null
      return {
        filename: f.filename,
        previousFilename: f.previous_filename ?? null,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: lines ? lines.slice(0, MAX_PATCH_LINES).join('\n') : null,
        patchTruncated: !!lines && lines.length > MAX_PATCH_LINES,
        url: f.blob_url,
      }
    }),
  }
}

// ---------- Release contents ----------

const RELEASE_PR_FIELDS = 'number title url state mergedAt headRefName baseRefName author { login } repository { nameWithOwner }'
const MAX_RELEASE_COMMITS = 250

export interface FoundPr {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  mergedAt: string | null
  headRefName: string
  baseRefName: string
  author: { login: string } | null
  repository: { nameWithOwner: string }
}

/**
 * PRs shipped by a release PR: each commit's associated PRs; for cherry-picked commits, the PR of the
 * original commit (from the "(cherry picked from commit …)" trailer); and PRs referenced in its description.
 * `keep(pr)` decides which associated PRs count (e.g. not the release itself, not backmerges).
 */
export async function releaseContents(
  account: GithubAccount,
  repo: string,
  number: number,
  body: string,
  keep: (pr: FoundPr) => boolean,
): Promise<{ items: (FoundPr & { via: 'commit' | 'cherry-pick' | 'description' })[]; commitsScanned: number; truncated: boolean }> {
  const [owner, name] = repo.split('/')
  const found = new Map<string, FoundPr & { via: 'commit' | 'cherry-pick' | 'description' }>()
  const add = (p: FoundPr | null | undefined, via: 'commit' | 'cherry-pick' | 'description') => {
    if (!p || !p.repository) return
    const key = `${p.repository.nameWithOwner.toLowerCase()}#${p.number}`
    if (!found.has(key) && (via === 'description' || keep(p))) found.set(key, { ...p, via })
  }

  // 1. Commits of the release PR, 100 per page
  const picked = new Set<string>()
  let after: string | null = null
  let scanned = 0
  let total = 0
  do {
    const data: any = await graphql(
      account.token,
      `query($owner: String!, $name: String!, $number: Int!, $after: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
         commits(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor }
           nodes { commit { message associatedPullRequests(first: 5) { nodes { ${RELEASE_PR_FIELDS} } } } } }
       } } }`,
      { owner, name, number, after },
    )
    const commits = data.repository?.pullRequest?.commits
    if (!commits) break
    total = commits.totalCount
    for (const n of commits.nodes) {
      scanned++
      for (const p of n.commit.associatedPullRequests.nodes) if (p.number !== number) add(p, 'commit')
      for (const m of String(n.commit.message).matchAll(/\(cherry picked from commit ([0-9a-f]{7,40})\)/g)) picked.add(m[1])
    }
    after = commits.pageInfo.hasNextPage && scanned < MAX_RELEASE_COMMITS ? commits.pageInfo.endCursor : null
  } while (after)

  // 2. Original commits of cherry-picks, 50 per query
  const shas = [...picked]
  for (let i = 0; i < shas.length; i += 50) {
    const part = shas.slice(i, i + 50)
    const data: any = await graphql(
      account.token,
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
         ${part.map((sha, j) => `c${j}: object(expression: "${sha}") { ... on Commit { associatedPullRequests(first: 5) { nodes { ${RELEASE_PR_FIELDS} } } } }`).join('\n')}
       } }`,
      { owner, name },
    )
    for (let j = 0; j < part.length; j++)
      for (const p of data.repository?.[`c${j}`]?.associatedPullRequests?.nodes ?? []) if (p.number !== number) add(p, 'cherry-pick')
  }

  // 3. PRs referenced in the description: #12 (this repo) and PR URLs (any repo)
  const refs = new Map<string, { owner: string; name: string; number: number }>()
  for (const m of body.matchAll(/(?<![\w/&])#(\d{1,6})\b/g)) refs.set(`${repo.toLowerCase()}#${m[1]}`, { owner, name, number: Number(m[1]) })
  for (const m of body.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g))
    refs.set(`${m[1]}/${m[2]}`.toLowerCase() + `#${m[3]}`, { owner: m[1], name: m[2], number: Number(m[3]) })
  const missing = [...refs].filter(([k]) => !found.has(k) && !(k === `${repo.toLowerCase()}#${number}`)).slice(0, 60)
  for (let i = 0; i < missing.length; i += 30) {
    const part = missing.slice(i, i + 30)
    const data: any = await graphql(
      account.token,
      `query { ${part.map(([, r], j) => `r${j}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) { pullRequest(number: ${r.number}) { ${RELEASE_PR_FIELDS} } }`).join('\n')} }`,
    ).catch(() => null) // a #number that is an issue, or a repo we can't read
    for (let j = 0; j < part.length; j++) {
      const p = (data as any)?.[`r${j}`]?.pullRequest
      if (p && p.state !== 'CLOSED') add(p, 'description')
    }
  }

  return { items: [...found.values()], commitsScanned: scanned, truncated: total > scanned }
}

// ---------- PR description edits ----------

export async function getPrBody(account: GithubAccount, repo: string, number: number): Promise<string> {
  const pr = await request<{ body: string | null }>(account.token, `/repos/${repo}/pulls/${number}`)
  return pr.body ?? ''
}

export async function updatePrBody(account: GithubAccount, repo: string, number: number, body: string): Promise<void> {
  await request(account.token, `/repos/${repo}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify({ body }) })
}
