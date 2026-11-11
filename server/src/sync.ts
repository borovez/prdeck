import type { GithubAccount, JiraIssue, PrId, PrRecord, Relation, SyncState } from '../../shared/types.ts'
import {
  deletePrsNotSyncedAt,
  getSettings,
  getSyncState,
  listManualDeps,
  listPrs,
  closeStaleSlack,
  pruneSlack,
  replaceJira,
  saveMyJiraKeys,
  upsertSlackItem,
  saveMyLogins,
  saveSettings,
  saveSyncState,
  setRelease,
  upsertPr,
} from './db.ts'
import { syncReleaseFlow } from './releases.ts'
import { integrationBranches, releaseBranches, releaseRefFor } from './flow.ts'
import { fetchPrsByRef, isCommitIn, resolveReleaseRef, searchPrs, whoAmI } from './github.ts'
import { fetchIssuesByKey, searchJql } from './jira.ts'
import { fetchSlackInbox } from './slack.ts'
import { extractJiraKeys, parseBodyDependencies, parsePrId } from './refs.ts'

let inFlight: Promise<SyncState> | null = null

/** Single-flight: concurrent callers share one run. */
export function runSync(): Promise<SyncState> {
  inFlight ??= doSync().finally(() => (inFlight = null))
  return inFlight
}

export const isSyncing = () => inFlight !== null

export function accountForOwner(accounts: GithubAccount[], owner: string): GithubAccount | undefined {
  const o = owner.toLowerCase()
  return (
    accounts.find((a) => a.orgs.some((x) => x.toLowerCase() === o) || a.login?.toLowerCase() === o) ??
    accounts.find((a) => a.orgs.length === 0) ??
    accounts[0]
  )
}

async function doSync(): Promise<SyncState> {
  const started = Date.now()
  const syncedAt = new Date(started).toISOString()
  const errors: string[] = []
  const prev = getSyncState()
  saveSyncState({ ...prev, running: true, lastStartedAt: syncedAt })

  const settings = getSettings()
  const accounts = settings.github.accounts.filter((a) => a.token)
  const found = new Map<PrId, { pr: PrRecord; relations: Set<Relation> }>()
  const add = (prs: PrRecord[], rel: Relation) => {
    for (const pr of prs) {
      const e = found.get(pr.id) ?? { pr, relations: new Set<Relation>() }
      e.pr = pr
      e.relations.add(rel)
      found.set(pr.id, e)
    }
  }

  // 1. GitHub searches, per account
  const logins: string[] = []
  let settingsDirty = false
  const since = new Date(started - settings.sync.mergedLookbackDays * 86400_000).toISOString().slice(0, 10)

  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const me = await whoAmI(acc.token)
        logins.push(me.login)
        if (acc.login !== me.login) {
          acc.login = me.login
          settingsDirty = true
        }
        const scope = acc.orgs.map((o) => ` org:${o}`).join('')
        const q = (s: string) => `is:pr archived:false ${s}${scope}`
        const searches: [string, Relation][] = [
          [q('is:open author:@me'), 'authored'],
          [q('is:open review-requested:@me'), 'review_requested'],
          [q('is:open reviewed-by:@me -author:@me'), 'reviewed'],
          [q('is:open assignee:@me'), 'assigned'],
          [q(`is:merged author:@me merged:>=${since}`), 'authored'],
        ]
        const tracked = settings.trackedRepos.filter((r) => accountForOwner(accounts, r.split('/')[0])?.id === acc.id)
        for (let i = 0; i < tracked.length; i += 8) {
          const repos = tracked
            .slice(i, i + 8)
            .map((r) => `repo:${r}`)
            .join(' ')
          searches.push([`is:pr is:open archived:false ${repos}`, 'tracked'])
        }
        // One search at a time: concurrent heavy GraphQL searches trip GitHub's secondary rate limit
        for (const [query, rel] of searches) {
          try {
            add(await searchPrs(acc, query), rel)
          } catch (e) {
            errors.push(`[${acc.label}] search "${query}": ${(e as Error).message}`)
          }
        }
      } catch (e) {
        errors.push(`[${acc.label}] ${(e as Error).message}`)
      }
    }),
  )
  if (settingsDirty) saveSettings(settings)
  if (logins.length) saveMyLogins([...new Set(logins)])

  // 2. Pull in dependency targets (and manual-dep sources) that searches didn't return. Two levels deep.
  const manual = listManualDeps()
  const keep = new Set<PrId>()
  for (const d of manual) keep.add(d.from).add(d.to)
  for (let round = 0; round < 2 && accounts.length; round++) {
    const wanted = new Set<PrId>(round === 0 ? keep : [])
    for (const { pr } of found.values()) for (const d of parseBodyDependencies(pr.body, pr.repo, pr.id)) wanted.add(d.to)
    const missing = [...wanted].filter((id) => !found.has(id))
    if (!missing.length) break
    const byAccount = new Map<GithubAccount, { owner: string; name: string; number: number }[]>()
    for (const id of missing) {
      const ref = parsePrId(id)
      if (!ref) continue
      const acc = accountForOwner(accounts, ref.owner)!
      byAccount.set(acc, [...(byAccount.get(acc) ?? []), ref])
      keep.add(id)
    }
    await Promise.all(
      [...byAccount].map(([acc, refs]) =>
        fetchPrsByRef(acc, refs).then(
          (prs) => add(prs, 'dependency'),
          (e) => errors.push(`[${acc.label}] dependency fetch: ${(e as Error).message}`),
        ),
      ),
    )
  }

  // 3. Persist. Only prune when GitHub actually answered, so a network blip doesn't wipe the cache.
  for (const { pr, relations } of found.values()) upsertPr(pr, [...relations], syncedAt)
  if (accounts.length && found.size > 0 && errors.length === 0 /* github-only so far */) deletePrsNotSyncedAt(syncedAt, keep)

  // 4. Release status for merged PRs
  const refCache = new Map<string, Promise<string | null>>()
  const stored = listPrs()
  const branches = releaseBranches(stored.map((s) => s.pr), integrationBranches(stored.map((s) => s.pr)))
  await Promise.all(
    stored
      .filter((s) => s.pr.state === 'MERGED' && s.pr.mergeCommitSha && !s.release?.released)
      .map(async ({ pr }) => {
        const acc = accounts.find((a) => a.id === pr.accountId) ?? accountForOwner(accounts, pr.owner)
        if (!acc) return
        const configured = releaseRefFor(pr.repo, settings, branches)
        try {
          if (!refCache.has(pr.repo)) refCache.set(pr.repo, resolveReleaseRef(acc, pr.repo, configured))
          const ref = await refCache.get(pr.repo)!
          const released = ref ? await isCommitIn(acc, pr.repo, pr.mergeCommitSha!, ref) : false
          setRelease(pr.id, { released, ref, checkedAt: syncedAt })
        } catch (e) {
          setRelease(pr.id, { released: false, ref: null, checkedAt: syncedAt, error: (e as Error).message })
        }
      }),
  )

  // 4b. Release PR contents and hotfix backmerges
  if (accounts.length) {
    try {
      await syncReleaseFlow(accounts, errors)
    } catch (e) {
      errors.push(`release contents: ${(e as Error).message}`)
    }
  }

  // 5. Jira
  let jiraCount = 0
  const jira = settings.jira
  if (jira?.apiToken) {
    try {
      const mine = jira.myJql ? await searchJql(jira, jira.myJql, true) : []
      const keys = new Set<string>()
      for (const { pr } of listPrs()) {
        let k = extractJiraKeys([pr.title, pr.headRef], jira.projectKeys)
        if (!k.length) k = extractJiraKeys([pr.body], jira.projectKeys)
        k.forEach((x) => keys.add(x))
      }
      const mineKeys = new Set(mine.map((i) => i.key))
      const { issues } = await fetchIssuesByKey(
        jira,
        [...keys].filter((k) => !mineKeys.has(k)),
      )
      const all: JiraIssue[] = [...mine, ...issues]
      replaceJira(all, syncedAt)
      saveMyJiraKeys([...mineKeys])
      jiraCount = all.length
    } catch (e) {
      errors.push(`[jira] ${(e as Error).message}`)
    }
  }

  // 6. Slack
  let slackCount = 0
  if (settings.slack?.token) {
    try {
      const r = await fetchSlackInbox(settings.slack)
      for (const { item, autoDone } of r.items) upsertSlackItem(item, autoDone)
      closeStaleSlack(r.completeKinds, new Set(r.items.filter((i) => r.completeKinds.includes(i.item.kind)).map((i) => i.item.id)))
      pruneSlack(new Date(started - settings.slack.lookbackDays * 2 * 86400_000).toISOString())
      slackCount = r.items.length
      errors.push(...r.errors.map((e) => `[slack] ${e}`))
    } catch (e) {
      errors.push(`[slack] ${(e as Error).message}`)
    }
  }

  const state: SyncState = {
    running: false,
    lastStartedAt: syncedAt,
    lastFinishedAt: new Date().toISOString(),
    lastDurationMs: Date.now() - started,
    errors,
    counts: { prs: found.size, jira: jiraCount, slack: slackCount },
  }
  saveSyncState(state)
  if (errors.length) console.warn('[sync] finished with errors:\n  ' + errors.join('\n  '))
  return state
}
