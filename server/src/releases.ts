import type { GithubAccount, PrRecord, ReleaseContents, TagRelease } from '../../shared/types.ts'
import { getSettings, listBackmerges, listPrs, listReleaseContents, listTagContents, pruneTagContents, setBackmerge, setReleaseContents, setTagContents } from './db.ts'
import { integrationBranches, isReleaseItemCandidate, prFlow, releaseBranches, releaseRefFor } from './flow.ts'
import { isCommitIn, latestTags, releaseContents, tagContents } from './github.ts'
import { extractJiraKeys, prId } from './refs.ts'
import { accountForOwner } from './sync.ts'

export const accountFor = (accounts: GithubAccount[], pr: PrRecord) => accounts.find((a) => a.id === pr.accountId) ?? accountForOwner(accounts, pr.owner)

/** Backmerges show up among a release's commits; they ship nothing new */
const BACKMERGE = /back-?merge/i

/** Work out (and cache) what a release PR ships */
export async function computeReleaseContents(account: GithubAccount, pr: PrRecord): Promise<ReleaseContents> {
  const projectKeys = getSettings().jira?.projectKeys ?? []
  const base: Omit<ReleaseContents, 'items' | 'jiraKeys' | 'commitsScanned' | 'truncated'> = {
    prId: pr.id,
    forUpdatedAt: pr.updatedAt,
    fetchedAt: new Date().toISOString(),
  }
  let out: ReleaseContents
  try {
    const r = await releaseContents(account, pr.repo, pr.number, pr.body ?? '', (p) => p.state === 'MERGED' && isReleaseItemCandidate(p.headRefName, p.baseRefName) && !BACKMERGE.test(`${p.headRefName} ${p.title}`))
    const items = r.items
      .filter((p) => !BACKMERGE.test(`${p.headRefName} ${p.title}`))
      .map((p) => ({
        id: prId(p.repository.nameWithOwner, p.number),
        title: p.title,
        url: p.url,
        author: p.author?.login ?? 'ghost',
        state: p.state,
        mergedAt: p.mergedAt,
        via: p.via,
        jira: extractJiraKeys([p.title, p.headRefName], projectKeys),
      }))
      .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
    const jiraKeys = [...new Set([...extractJiraKeys([pr.title, pr.headRef], projectKeys), ...items.flatMap((i) => i.jira)])].sort()
    out = { ...base, items: items.map(({ jira: _j, ...i }) => i), jiraKeys, commitsScanned: r.commitsScanned, truncated: r.truncated }
  } catch (e) {
    out = { ...base, items: [], jiraKeys: [], commitsScanned: 0, truncated: false, error: (e as Error).message }
  }
  setReleaseContents(out)
  return out
}

/**
 * Sync step: contents of release PRs that are open and changed since the last run (or never computed),
 * and backmerge checks for merged hotfixes that haven't reached the integration branch yet.
 */
export async function syncReleaseFlow(accounts: GithubAccount[], errors: string[]) {
  const prs = listPrs().map((s) => s.pr)
  const integration = integrationBranches(prs)
  const cached = new Map(listReleaseContents().map((c) => [c.prId, c]))
  for (const pr of prs) {
    if (prFlow(pr, integration) !== 'release' || pr.state === 'CLOSED') continue
    const c = cached.get(pr.id)
    const stale = !c || (pr.state === 'OPEN' && c.forUpdatedAt !== pr.updatedAt) || (c.error && c.forUpdatedAt !== pr.updatedAt)
    if (!stale) continue
    const acc = accountFor(accounts, pr)
    if (!acc) continue
    const r = await computeReleaseContents(acc, pr) // one at a time: a few GraphQL calls each
    if (r.error) errors.push(`[release ${pr.id}] ${r.error}`)
  }

  const checked = listBackmerges()
  for (const pr of prs) {
    if (prFlow(pr, integration) !== 'hotfix' || pr.state !== 'MERGED' || !pr.mergeCommitSha) continue
    if (checked.get(pr.id)?.backmerged) continue
    const into = integration.get(pr.repo.toLowerCase())
    const acc = accountFor(accounts, pr)
    if (!into || !acc) continue
    try {
      setBackmerge(pr.id, { backmerged: await isCommitIn(acc, pr.repo, pr.mergeCommitSha, into), into, checkedAt: new Date().toISOString() })
    } catch (e) {
      setBackmerge(pr.id, { backmerged: false, into, checkedAt: new Date().toISOString(), error: (e as Error).message })
    }
  }
}

const TAGS_PER_REPO = 5

/**
 * Sync step: for repos that release through tags, what each of the latest tags shipped
 * (previous tag → tag). Tags don't move, so each is computed once; older ones drop off.
 */
export async function syncTags(accounts: GithubAccount[], errors: string[]) {
  const settings = getSettings()
  const projectKeys = settings.jira?.projectKeys ?? []
  const prs = listPrs().map((s) => s.pr)
  const branches = releaseBranches(prs, integrationBranches(prs))
  const repos = new Map<string, PrRecord>()
  for (const pr of prs) if (releaseRefFor(pr.repo, settings, branches) === 'latest-release' && pr.state === 'MERGED') repos.set(pr.repo.toLowerCase(), pr)
  const cached = new Set(listTagContents().map((t) => t.prId))

  for (const pr of repos.values()) {
    const acc = accountFor(accounts, pr)
    if (!acc) continue
    try {
      // One extra so the oldest kept tag has a previous one to compare with
      const tags = await latestTags(acc, pr.repo, TAGS_PER_REPO + 1)
      const keep: string[] = []
      for (let i = 0; i < Math.min(TAGS_PER_REPO, tags.length); i++) {
        const tag = tags[i]
        const previous = tags[i + 1]?.name ?? null
        const id = `${pr.repo.toLowerCase()}@${tag.name}`
        keep.push(id)
        if (cached.has(id)) continue
        const base = {
          prId: id,
          repo: pr.repo,
          tag: tag.name,
          previous,
          date: tag.date,
          url: `https://github.com/${pr.repo}/releases/tag/${encodeURIComponent(tag.name)}`,
          forUpdatedAt: tag.date ?? '',
          fetchedAt: new Date().toISOString(),
        }
        let t: TagRelease
        if (!previous) t = { ...base, items: [], jiraKeys: [], commitsScanned: 0, truncated: false, error: 'First tag: nothing to compare with' }
        else
          try {
            const r = await tagContents(acc, pr.repo, previous, tag.name, (p) => p.state === 'MERGED' && !BACKMERGE.test(`${p.headRefName} ${p.title}`))
            const items = r.items
              .map((p) => ({ id: prId(p.repository.nameWithOwner, p.number), title: p.title, url: p.url, author: p.author?.login ?? 'ghost', state: p.state, mergedAt: p.mergedAt, via: p.via, head: p.headRefName }))
              .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
            const jiraKeys = [...new Set(items.flatMap((i) => extractJiraKeys([i.title, i.head], projectKeys)))].sort()
            t = { ...base, items: items.map(({ head: _h, ...i }) => i), jiraKeys, commitsScanned: r.commitsScanned, truncated: r.truncated }
          } catch (e) {
            t = { ...base, items: [], jiraKeys: [], commitsScanned: 0, truncated: false, error: (e as Error).message }
          }
        setTagContents(t)
      }
      pruneTagContents(pr.repo, keep)
    } catch (e) {
      errors.push(`[tags ${pr.repo}] ${(e as Error).message}`)
    }
  }
}
