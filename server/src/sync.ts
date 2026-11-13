import type { GithubAccount, JiraIssue, PrId, PrRecord, Relation, SyncState, SyncStep } from '../../shared/types.ts'
import {
  replaceFeatureFlags,
  listFeatureFlags,
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
import { syncReleaseFlow, syncTags } from './releases.ts'
import { integrationBranches, releaseBranches, releaseRefFor } from './flow.ts'
import { fetchPrsByNodeId, fetchPrsByRef, isCommitIn, resolveReleaseRef, searchPrHits, whoAmI, type PrHit } from './github.ts'
import { fetchIssuesByKey, searchJql } from './jira.ts'
import { fetchSlackInbox } from './slack.ts'
import { extractJiraKeys, parseBodyDependencies, parseFeatureFlags, parsePrId } from './refs.ts'
import { getFlag } from './launchdarkly.ts'

let inFlight: Promise<SyncState> | null = null

/** Single-flight: concurrent callers share one run. */
export function runSync(): Promise<SyncState> {
  inFlight ??= doSync().finally(() => (inFlight = null))
  return inFlight
}

export const isSyncing = () => inFlight !== null

const STEPS: [id: string, label: string][] = [
  ['github', 'GitHub pull requests'],
  ['deps', 'Dependency targets'],
  ['released', 'Release status'],
  ['releases', 'Release contents and tags'],
  ['flags', 'LaunchDarkly flags'],
  ['jira', 'Jira issues'],
  ['slack', 'Slack inbox'],
]

/**
 * Step progress, written to the sync state at every change so the header (and another process,
 * e.g. the MCP server's sync) can show what's running, done and queued.
 */
function progress(base: SyncState) {
  const steps: SyncStep[] = STEPS.map(([id, label]) => ({ id, label, status: 'queued' }))
  const save = () => saveSyncState({ ...base, running: true, steps: steps.map((s) => ({ ...s })) })
  const step = (id: string) => steps.find((s) => s.id === id)!
  let lastNote = 0
  save()
  return {
    steps,
    /**
     * Run one step. It gets its own error list (steps run in parallel), appended to `errors` when it
     * ends; any error marks the step failed.
     */
    async run<T>(id: string, errors: string[], fn: (errors: string[]) => Promise<T>, detail?: (r: T) => string | undefined): Promise<void> {
      const s = step(id)
      const mine: string[] = []
      s.status = 'running'
      s.startedAt = new Date().toISOString()
      save()
      try {
        const r = await fn(mine)
        s.status = mine.length ? 'error' : 'done'
        s.detail = mine.length ? mine[0] : detail?.(r)
      } catch (e) {
        s.status = 'error'
        s.detail = (e as Error).message
        mine.push((e as Error).message)
      } finally {
        errors.push(...mine)
        s.finishedAt = new Date().toISOString()
        save()
      }
    },
    /** Progress text on a running step ("search 3 of 12"); saved at most every 300 ms */
    note(id: string, text: string) {
      step(id).detail = text
      const t = Date.now()
      if (t - lastNote > 300) (lastNote = t), save()
    },
    skip(id: string, why: string) {
      Object.assign(step(id), { status: 'skipped', detail: why })
      save()
    },
  }
}

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
  const p = progress({ ...prev, running: true, lastStartedAt: syncedAt })

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

  // Slack needs nothing from GitHub: it runs alongside everything else
  let slackCount = 0
  const slackStep = (async () => {
    const slack = settings.slack
    if (!slack?.token) p.skip('slack', 'Not connected')
    else await p.run('slack', errors, async (errors) => {
      try {
        const r = await fetchSlackInbox(slack)
        for (const { item, autoDone } of r.items) upsertSlackItem(item, autoDone)
        closeStaleSlack(r.completeKinds, new Set(r.items.filter((i) => r.completeKinds.includes(i.item.kind)).map((i) => i.item.id)))
        pruneSlack(new Date(started - slack.lookbackDays * 2 * 86400_000).toISOString())
        slackCount = r.items.length
        errors.push(...r.errors.map((e) => `[slack] ${e}`))
      } catch (e) {
        errors.push(`[slack] ${(e as Error).message}`)
      }
    }, () => `${slackCount} items`)
  })()

  // 1. GitHub searches, per account
  const logins: string[] = []
  let settingsDirty = false
  const since = new Date(started - settings.sync.mergedLookbackDays * 86400_000).toISOString().slice(0, 10)

  // Searches return ids only; full PR fields are fetched once per PR afterwards, and only when needed
  const hits = new Map<PrId, { hit: PrHit; acc: GithubAccount; relations: Set<Relation> }>()
  let searchDone = 0
  let searchTotal = 0
  let reused = 0
  if (!accounts.length) p.skip('github', 'No GitHub account')
  else await p.run('github', errors, async (errors) => {
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
          searchTotal += searches.length
          // Two at a time: id-only searches are light, but many concurrent searches trip GitHub's secondary rate limit
          let next = 0
          const worker = async () => {
            while (next < searches.length) {
              const [query, rel] = searches[next++]
              try {
                for (const hit of await searchPrHits(acc, query)) {
                  const e = hits.get(hit.id) ?? { hit, acc, relations: new Set<Relation>() }
                  e.relations.add(rel)
                  hits.set(hit.id, e)
                }
              } catch (e) {
                errors.push(`[${acc.label}] search "${query}": ${(e as Error).message}`)
              }
              p.note('github', `Search ${++searchDone} of ${searchTotal} · ${hits.size} PRs`)
            }
          }
          await Promise.all([worker(), worker()])
        } catch (e) {
          errors.push(`[${acc.label}] ${(e as Error).message}`)
        }
      }),
    )

    // Open PRs always change (checks, mergeability don't touch updatedAt); merged and closed PRs only
    // when updatedAt moved, so those reuse the stored copy
    const stored = new Map(listPrs().map((s) => [s.pr.id, s.pr]))
    const toFetch = new Map<GithubAccount, string[]>()
    for (const { hit, acc, relations } of hits.values()) {
      const old = stored.get(hit.id)
      if (old && hit.state !== 'OPEN' && old.state === hit.state && old.updatedAt === hit.updatedAt && old.nodeId) {
        add([old], [...relations][0])
        for (const r of relations) found.get(hit.id)!.relations.add(r)
        reused++
      } else toFetch.set(acc, [...(toFetch.get(acc) ?? []), hit.nodeId])
    }
    const total = [...toFetch.values()].reduce((n, ids) => n + ids.length, 0)
    let fetched = 0
    p.note('github', `Fetching ${total} PRs${reused ? ` · ${reused} unchanged` : ''}`)
    await Promise.all(
      [...toFetch].map(async ([acc, ids]) => {
        let mine = 0
        const r = await fetchPrsByNodeId(acc, ids, (n) => {
          fetched += n - mine
          mine = n
          p.note('github', `Fetched ${fetched} of ${total} PRs${reused ? ` · ${reused} unchanged` : ''}`)
        })
        for (const pr of r.prs) for (const rel of hits.get(pr.id)?.relations ?? []) add([pr], rel)
        if (r.errors.length) errors.push(`[${acc.label}] PR details: ${r.errors[0]}${r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''}`)
      }),
    )
  }, () => `${found.size} PRs · ${found.size - reused} fetched, ${reused} unchanged`)
  if (settingsDirty) saveSettings(settings)
  if (logins.length) saveMyLogins([...new Set(logins)])

  // 2. Pull in dependency targets (and manual-dep sources) that searches didn't return. Two levels deep.
  const manual = listManualDeps()
  const keep = new Set<PrId>()
  for (const d of manual) keep.add(d.from).add(d.to)
  if (!accounts.length) p.skip('deps', 'No GitHub account')
  else await p.run('deps', errors, async (errors) => {
    for (let round = 0; round < 2; round++) {
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
  }, () => `${[...found.values()].filter((f) => f.relations.has('dependency')).length} pulled in`)

  // 3. Persist. Only prune when GitHub actually answered, so a network blip doesn't wipe the cache.
  for (const { pr, relations } of found.values()) upsertPr(pr, [...relations], syncedAt)
  if (accounts.length && found.size > 0 && p.steps.every((s) => (s.id !== 'github' && s.id !== 'deps') || s.status === 'done')) deletePrsNotSyncedAt(syncedAt, keep)

  // After the PRs are saved, the release checks, LaunchDarkly and Jira only read them: run them together
  const releaseSteps = (async () => {
    // 4. Release status for merged PRs
    const refCache = new Map<string, Promise<string | null>>()
    const stored = listPrs()
    const branches = releaseBranches(stored.map((s) => s.pr), integrationBranches(stored.map((s) => s.pr)))
    const unreleased = stored.filter((s) => s.pr.state === 'MERGED' && s.pr.mergeCommitSha && !s.release?.released)
    let checked = 0
    if (!accounts.length) p.skip('released', 'No GitHub account')
    else await p.run('released', errors, (errors) => Promise.all(
      unreleased
        .map(async ({ pr }) => {
          const acc = accounts.find((a) => a.id === pr.accountId) ?? accountForOwner(accounts, pr.owner)
          if (!acc) return
          const configured = releaseRefFor(pr.repo, settings, branches)
          try {
            if (!refCache.has(pr.repo)) refCache.set(pr.repo, resolveReleaseRef(acc, pr.repo, configured))
            const ref = await refCache.get(pr.repo)!
            const released = ref ? await isCommitIn(acc, pr.repo, pr.mergeCommitSha!, ref) : false
            setRelease(pr.id, { released, ref, checkedAt: syncedAt })
            p.note('released', `${++checked} of ${unreleased.length} merged PRs`)
          } catch (e) {
            setRelease(pr.id, { released: false, ref: null, checkedAt: syncedAt, error: (e as Error).message })
          }
        }),
    ), () => `${unreleased.length} merged PRs checked`)

    // 4b. Release PR contents and hotfix backmerges
    if (!accounts.length) p.skip('releases', 'No GitHub account')
    else await p.run('releases', errors, async (errors) => {
      try {
        await syncReleaseFlow(accounts, errors)
        await syncTags(accounts, errors)
      } catch (e) {
        errors.push(`release contents: ${(e as Error).message}`)
      }
    })

  })()
  const flagSteps = (async () => {
    // 4c. LaunchDarkly (read only): state of the flags PR descriptions mention
    const ld = settings.launchdarkly
    if (!ld?.apiToken || !ld.projectKey) p.skip('flags', 'Not connected')
    else await p.run('flags', errors, async (errors) => {
      try {
        const keys = [...new Set(listPrs().flatMap(({ pr }) => parseFeatureFlags(pr.body)))]
        const flags = []
        // A few at a time
        for (let i = 0; i < keys.length; i += 4) flags.push(...(await Promise.all(keys.slice(i, i + 4).map((k) => getFlag(ld, k)))))
        // A failed request (network, rate limit) keeps the last known state instead of replacing it with an error
        const previous = new Map(listFeatureFlags().map((f) => [f.key, f]))
        const failed = flags.filter((f) => f.error && !f.error.startsWith('Not found'))
        replaceFeatureFlags(flags.map((f) => (f.error && !f.error.startsWith('Not found') && previous.get(f.key)?.envs.length ? previous.get(f.key)! : f)))
        if (failed.length) errors.push(`LaunchDarkly: ${failed[0].error}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`)
        return keys.length
      } catch (e) {
        errors.push(`LaunchDarkly: ${(e as Error).message}`)
      }
    }, (n) => (n === undefined ? undefined : `${n} flags`))

  })()
  let jiraCount = 0
  const jiraStep = (async () => {
    const jira = settings.jira
    if (!jira?.apiToken) p.skip('jira', 'Not connected')
    else await p.run('jira', errors, async (errors) => {
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
    }, () => `${jiraCount} issues`)

  })()
  await Promise.all([releaseSteps, flagSteps, jiraStep, slackStep])

  const state: SyncState = {
    running: false,
    lastStartedAt: syncedAt,
    lastFinishedAt: new Date().toISOString(),
    lastDurationMs: Date.now() - started,
    errors,
    counts: { prs: found.size, jira: jiraCount, slack: slackCount },
    steps: p.steps,
  }
  saveSyncState(state)
  if (errors.length) console.warn('[sync] finished with errors:\n  ' + errors.join('\n  '))
  return state
}
