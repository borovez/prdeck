import { aiAvailable } from './ai.ts'
import { releaseStatus } from '../../shared/release.ts'
import type {
  ActionKind,
  Bucket,
  DepEdge,
  DependencyChain,
  JiraIssue,
  JiraIssueView,
  Overview,
  PrId,
  PrView,
  ReleaseContents,
  ReleaseInfo,
  ReleaseTrain,
} from '../../shared/types.ts'
import { ACTION_LABELS } from '../../shared/types.ts'
import {
  getMyJiraKeys,
  getMyLogins,
  getSettings,
  getSyncState,
  listJira,
  listManualDeps,
  listMeta,
  listPrs,
  listSlack,
  listBackmerges,
  listReleaseContents,
  listTagContents,
  type StoredPr,
} from './db.ts'
import { integrationBranches, prFlow, releaseBranches, releaseRefFor } from './flow.ts'
import { extractJiraKeys, parseBodyDependencies } from './refs.ts'
import { isSyncing } from './sync.ts'

/** Everything the UI and MCP need, derived from the cache. Pure read – cheap enough to run per request. */
export function buildOverview(): Overview {
  const settings = getSettings()
  const me = getMyLogins()
  const meSet = new Set(me.map((l) => l.toLowerCase()))
  const stored = listPrs()
  const byId = new Map<PrId, StoredPr>(stored.map((s) => [s.pr.id, s]))
  const jiraList = listJira()
  const myJira = new Set(getMyJiraKeys())
  const jira = new Map<string, JiraIssue>(jiraList.map((i) => [i.key, { ...i, isMine: i.isMine || myJira.has(i.key) }]))
  const meta = listMeta()
  const projectKeys = settings.jira?.projectKeys ?? []

  // --- Jira keys per PR
  const keysByPr = new Map<PrId, string[]>()
  const prsByKey = new Map<string, PrId[]>()
  for (const { pr } of stored) {
    let keys = extractJiraKeys([pr.title, pr.headRef], projectKeys)
    if (!keys.length) keys = extractJiraKeys([pr.body], projectKeys)
    keysByPr.set(pr.id, keys)
    for (const k of keys) prsByKey.set(k, [...(prsByKey.get(k) ?? []), pr.id])
  }

  // --- Dependency edges: manual > body > jira for the same pair
  const edgeMap = new Map<string, Omit<DepEdge, 'satisfied' | 'missing'>>()
  const put = (e: Omit<DepEdge, 'satisfied' | 'missing'>) => {
    if (e.from === e.to) return
    const k = `${e.from}->${e.to}`
    const prio = { manual: 3, body: 2, jira: 1 }
    const cur = edgeMap.get(k)
    if (!cur || prio[e.source] > prio[cur.source]) edgeMap.set(k, e)
  }
  for (const d of listManualDeps()) put({ id: d.id, from: d.from, to: d.to, kind: d.kind, source: 'manual', note: d.note })
  for (const { pr } of stored)
    for (const d of parseBodyDependencies(pr.body, pr.repo, pr.id))
      put({ id: null, from: pr.id, to: d.to, kind: d.kind, source: 'body', note: null })
  // Jira: if issue A "is blocked by" B, PRs of A depend on PRs of B
  for (const [key, prIds] of prsByKey) {
    const issue = jira.get(key)
    if (!issue) continue
    for (const l of issue.links) {
      if (!(l.type.toLowerCase() === 'blocks' && l.direction === 'inward')) continue
      for (const from of prIds)
        for (const to of prsByKey.get(l.key) ?? [])
          put({ id: null, from, to, kind: 'merge', source: 'jira', note: `${key} is blocked by ${l.key}` })
    }
  }

  const edges: DepEdge[] = [...edgeMap.values()].map((e) => {
    const target = byId.get(e.to)
    const merged = target?.pr.state === 'MERGED'
    // A closed (unmerged) prerequisite is abandoned and no longer blocks; matches isDone() in buildChains
    const closed = target?.pr.state === 'CLOSED'
    const satisfied = closed || (e.kind === 'merge' ? merged : merged && !!target?.release?.released)
    return { ...e, satisfied, missing: !target }
  })
  const out = new Map<PrId, DepEdge[]>()
  const inc = new Map<PrId, DepEdge[]>()
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e])
    inc.set(e.to, [...(inc.get(e.to) ?? []), e])
  }

  // --- Release flow: release / hotfix / backmerge, what each release ships, hotfix backmerges
  const integration = integrationBranches(stored.map((s) => s.pr))
  const flows = new Map(stored.map(({ pr }) => [pr.id, prFlow(pr, integration)]))
  const branches = releaseBranches(stored.map((s) => s.pr), integration)
  const releases = listReleaseContents().filter((c) => flows.get(c.prId) === 'release')
  const shipsIn = new Map<PrId, { id: PrId; state: 'OPEN' | 'MERGED' | 'CLOSED' }[]>()
  for (const c of releases) {
    const state = byId.get(c.prId)?.pr.state ?? 'OPEN'
    if (state === 'CLOSED') continue
    for (const i of c.items) shipsIn.set(i.id, [...(shipsIn.get(i.id) ?? []), { id: c.prId, state }])
  }
  for (const list of shipsIn.values()) list.sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN'))
  const backmerges = listBackmerges()
  // Tags, newest first per repo; each PR's tag is the oldest tag that contains it
  const tags = listTagContents().sort((a, b) => a.repo.localeCompare(b.repo) || (b.date ?? '').localeCompare(a.date ?? ''))
  const releasedIn = new Map<PrId, { tag: string; url: string }>()
  for (const t of tags) for (const i of t.items) releasedIn.set(i.id, { tag: t.tag, url: t.url })
  // Open backmerge PRs per repo (release branch → integration branch)
  const openBackmerge = new Map<string, PrId>()
  for (const { pr } of stored)
    if (pr.state === 'OPEN' && flows.get(pr.id) === 'backmerge') openBackmerge.set(pr.repo.toLowerCase(), pr.id)

  // --- PR views
  const prs: PrView[] = stored.map(({ pr, relations, release }) => {
    const configuredRef = releaseRefFor(pr.repo, settings, branches)
    const releaseView: ReleaseInfo | null = release ? { ...release, via: configuredRef === 'latest-release' ? 'release' : 'branch' } : null
    const { body: _body, ...rest } = pr
    const isMine = meSet.has(pr.author.login.toLowerCase())
    const dependsOn = out.get(pr.id) ?? []
    const dependents = inc.get(pr.id) ?? []
    const blocked = pr.state === 'OPEN' && dependsOn.some((e) => !e.satisfied)
    const approvals = pr.reviews.filter((r) => r.state === 'APPROVED').map((r) => r.login)
    const changesRequestedBy = pr.reviews.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.login)
    const reviewRequestedFromMe =
      relations.includes('review_requested') ||
      pr.requestedReviewers.some((r) => !r.isTeam && !!r.login && meSet.has(r.login.toLowerCase()))

    let kind: ActionKind
    let bucket: Bucket
    let detail: string | undefined
    const checksBad = pr.checks.state === 'FAILURE' || pr.checks.state === 'ERROR'
    const waitingOnRelease = dependents.filter((e) => e.kind === 'release' && !e.satisfied)

    if (pr.state === 'CLOSED') {
      ;[kind, bucket] = ['done', 'done']
    } else if (pr.state === 'MERGED') {
      const bm = flows.get(pr.id) === 'hotfix' ? backmerges.get(pr.id) : undefined
      if (bm && !bm.backmerged && !bm.error && isMine) {
        ;[kind, bucket] = ['backmerge', 'action']
        const open = openBackmerge.get(pr.repo.toLowerCase())
        detail = open ? `Not in ${bm.into} yet; backmerge ${open} is open` : `Not in ${bm.into} yet; merge ${pr.baseRef} back into ${bm.into}`
      } else if (waitingOnRelease.length && !release?.released) {
        kind = 'release'
        bucket = isMine || relations.includes('tracked') ? 'action' : 'waiting'
        detail = `${waitingOnRelease.length} PR(s) wait on this release`
      } else if (isMine && release && !release.released) {
        ;[kind, bucket] = ['awaiting_release', 'waiting']
        detail = releaseStatus(releaseView!).long
      } else {
        ;[kind, bucket] = ['done', 'done']
      }
    } else if (!isMine && reviewRequestedFromMe) {
      ;[kind, bucket] = ['review', 'action']
    } else if (isMine) {
      if (pr.isDraft) [kind, bucket] = ['finish_draft', 'action']
      else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
        ;[kind, bucket] = ['address_feedback', 'action']
        detail = changesRequestedBy.join(', ')
      } else if (pr.mergeable === 'CONFLICTING') [kind, bucket] = ['resolve_conflicts', 'action']
      else if (checksBad) {
        ;[kind, bucket] = ['fix_ci', 'action']
        detail = pr.checks.failing.map((f) => f.name).slice(0, 3).join(', ')
      } else if (blocked) [kind, bucket] = ['wait_deps', 'blocked']
      else if (pr.reviewDecision === 'APPROVED' && pr.checks.state !== 'PENDING') [kind, bucket] = ['merge', 'action']
      else [kind, bucket] = ['wait_review', 'waiting']
    } else {
      ;[kind, bucket] = blocked ? ['wait_deps', 'blocked'] : ['none', 'watching']
    }
    if (kind === 'wait_deps') {
      detail = dependsOn
        .filter((e) => !e.satisfied)
        .map((e) => `${e.to} (${e.kind === 'release' ? 'release' : 'merge'})`)
        .join(', ')
    }

    const m = meta.get(pr.id)
    return {
      ...rest,
      threads: rest.threads ?? [], // PRs cached before thread details were synced
      relations,
      isMine,
      jiraKeys: keysByPr.get(pr.id) ?? [],
      release: releaseView,
      dependsOn,
      dependents,
      blocked,
      action: { kind, label: ACTION_LABELS[kind], detail },
      bucket,
      note: m?.note ?? null,
      pinned: m?.pinned ?? false,
      approvals,
      changesRequestedBy,
      flow: flows.get(pr.id) ?? null,
      shipsIn: shipsIn.get(pr.id) ?? [],
      backmerge: flows.get(pr.id) === 'hotfix' ? (backmerges.get(pr.id) ?? null) : null,
      backmergePr: flows.get(pr.id) === 'hotfix' && pr.state === 'MERGED' ? (openBackmerge.get(pr.repo.toLowerCase()) ?? null) : null,
      releasedIn: releasedIn.get(pr.id) ?? null,
    }
  })

  const jiraViews: JiraIssueView[] = [...jira.values()].map((i) => ({ ...i, prs: prsByKey.get(i.key) ?? [] }))

  const slack = listSlack()
  const stats = {
    action: 0,
    waiting: 0,
    blocked: 0,
    watching: 0,
    done: 0,
    reviewRequests: 0,
    mine: 0,
    slackNew: slack.filter((i) => i.status === 'new').length,
    myThreads: 0,
    myThreadPrs: 0,
  }
  for (const p of prs) {
    stats[p.bucket]++
    if (p.action.kind === 'review') stats.reviewRequests++
    if (p.isMine && p.state === 'OPEN') {
      stats.mine++
      stats.myThreads += p.unresolvedThreads
      if (p.unresolvedThreads) stats.myThreadPrs++
    }
  }

  return {
    me,
    prs,
    edges,
    chains: buildChains(prs, edges),
    releases,
    trains: buildTrains(prs, edges, releases),
    tags,
    jira: jiraViews,
    slack,
    stats,
    sync: { ...getSyncState(), running: isSyncing() },
    configured: {
      github: settings.github.accounts.some((a) => a.token),
      jira: !!settings.jira?.apiToken,
      slack: !!settings.slack?.token,
      ai: aiAvailable(settings.ai),
    },
    jiraBaseUrl: settings.jira?.baseUrl ?? null,
    autoSync: { enabled: settings.sync.auto, intervalMinutes: settings.sync.intervalMinutes },
  }
}

/** Connected components of the dependency graph, each topologically sorted (prerequisites first). */
function buildChains(prs: PrView[], edges: DepEdge[]): DependencyChain[] {
  const nodes = new Set<PrId>()
  const adj = new Map<PrId, Set<PrId>>()
  const link = (a: PrId, b: PrId) => {
    nodes.add(a).add(b)
    adj.set(a, (adj.get(a) ?? new Set()).add(b))
    adj.set(b, (adj.get(b) ?? new Set()).add(a))
  }
  edges.forEach((e) => link(e.from, e.to))
  const byId = new Map(prs.map((p) => [p.id, p]))
  const seen = new Set<PrId>()
  const chains: DependencyChain[] = []

  for (const start of nodes) {
    if (seen.has(start)) continue
    const comp: PrId[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const n = stack.pop()!
      comp.push(n)
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m))
    }
    // Kahn's algorithm: prerequisite (to) before dependent (from)
    const set = new Set(comp)
    const indeg = new Map<PrId, number>(comp.map((c) => [c, 0]))
    const compEdges = edges.filter((e) => set.has(e.from))
    compEdges.forEach((e) => indeg.set(e.from, indeg.get(e.from)! + 1))
    const queue = comp.filter((c) => indeg.get(c) === 0).sort()
    const order: PrId[] = []
    while (queue.length) {
      const n = queue.shift()!
      order.push(n)
      for (const e of compEdges)
        if (e.to === n) {
          indeg.set(e.from, indeg.get(e.from)! - 1)
          if (indeg.get(e.from) === 0) queue.push(e.from)
        }
    }
    for (const c of comp) if (!order.includes(c)) order.push(c) // cycle: append the rest

    const isDone = (id: PrId) => {
      const p = byId.get(id)
      if (!p) return false
      if (p.state === 'CLOSED') return true
      if (p.state !== 'MERGED') return false
      const needsRelease = compEdges.some((e) => e.to === id && e.kind === 'release')
      return !needsRelease || !!p.release?.released
    }
    const nextStep = order.find((id) => !isDone(id)) ?? null
    chains.push({
      id: order[0],
      prs: order,
      repos: [...new Set(order.map((id) => id.split('#')[0]))],
      nextStep,
      done: nextStep === null,
    })
  }
  // Active chains first, then bigger ones
  return chains.sort((a, b) => Number(a.done) - Number(b.done) || b.prs.length - a.prs.length)
}

/**
 * Release trains: open releases linked by dependencies between what they ship (with an order) or by shared
 * Jira issues across repos (no order). Merged releases join only through dependencies, as finished steps.
 */
function buildTrains(prs: PrView[], edges: DepEdge[], releases: ReleaseContents[]): ReleaseTrain[] {
  const byId = new Map(prs.map((p) => [p.id, p]))
  const repoOf = (id: PrId) => id.split('#')[0]
  const live = releases.filter((r) => byId.get(r.prId) && byId.get(r.prId)!.state !== 'CLOSED')
  // What each release contains (itself included)
  const contains = new Map(live.map((r) => [r.prId, new Set([r.prId, ...r.items.map((i) => i.id)])]))
  const holders = (id: PrId) => live.filter((r) => contains.get(r.prId)!.has(id)).map((r) => r.prId)

  const links = new Map<string, ReleaseTrain['links'][number]>()
  const link = (from: PrId, to: PrId, kind: 'order' | 'jira', reason: string) => {
    const key = kind === 'order' ? `o:${from}>${to}` : `j:${[from, to].sort().join('|')}`
    const l = links.get(key) ?? { from, to, kind, reasons: [] }
    if (!l.reasons.includes(reason)) l.reasons.push(reason)
    links.set(key, l)
  }
  for (const e of edges)
    for (const a of holders(e.to))
      for (const b of holders(e.from)) {
        // Same release, or one release inside the other: no order between them. Only open releases can wait.
        if (a === b || contains.get(a)!.has(b) || contains.get(b)!.has(a) || byId.get(b)!.state !== 'OPEN') continue
        link(a, b, 'order', `${e.from} needs ${e.to} ${e.kind === 'release' ? 'released' : 'merged'}`)
      }
  const open = live.filter((r) => byId.get(r.prId)!.state === 'OPEN')
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) {
      const [a, b] = [open[i], open[j]]
      if (repoOf(a.prId) === repoOf(b.prId)) continue
      const shared = a.jiraKeys.filter((k) => b.jiraKeys.includes(k))
      if (shared.length) link(a.prId, b.prId, 'jira', `both ship ${shared.join(', ')}`)
    }

  // Connected components with at least one open release and two repos
  const adj = new Map<PrId, Set<PrId>>()
  for (const l of links.values()) {
    adj.set(l.from, (adj.get(l.from) ?? new Set()).add(l.to))
    adj.set(l.to, (adj.get(l.to) ?? new Set()).add(l.from))
  }
  const seen = new Set<PrId>()
  const trains: ReleaseTrain[] = []
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue
    const comp: PrId[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const n = stack.pop()!
      comp.push(n)
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m))
    }
    if (comp.length < 2 || !comp.some((id) => byId.get(id)?.state === 'OPEN') || new Set(comp.map(repoOf)).size < 2) continue
    const set = new Set(comp)
    const own = [...links.values()].filter((l) => set.has(l.from) && set.has(l.to))
    const order = own.filter((l) => l.kind === 'order')
    // Kahn's algorithm; merged releases and stable id order break ties
    const indeg = new Map(comp.map((id) => [id, 0]))
    for (const l of order) indeg.set(l.to, indeg.get(l.to)! + 1)
    const rank = (id: PrId) => (byId.get(id)?.state === 'MERGED' ? 0 : 1)
    const queue = comp.filter((id) => indeg.get(id) === 0)
    const sorted: PrId[] = []
    while (queue.length) {
      queue.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      const n = queue.shift()!
      sorted.push(n)
      for (const l of order)
        if (l.from === n) {
          indeg.set(l.to, indeg.get(l.to)! - 1)
          if (indeg.get(l.to) === 0) queue.push(l.to)
        }
    }
    const cycle = sorted.length < comp.length
    for (const id of comp.sort()) if (!sorted.includes(id)) sorted.push(id)
    const next = !order.length
      ? null
      : sorted.find((id) => byId.get(id)?.state === 'OPEN' && order.filter((l) => l.to === id).every((l) => byId.get(l.from)?.state === 'MERGED')) ?? null
    // Issues shipped from more than one repo
    const keys = new Map<string, Set<string>>()
    for (const id of comp) for (const k of releases.find((r) => r.prId === id)?.jiraKeys ?? []) keys.set(k, (keys.get(k) ?? new Set()).add(repoOf(id)))
    trains.push({
      id: sorted[0],
      releases: sorted,
      links: own,
      jiraKeys: [...keys].filter(([, repos]) => repos.size > 1).map(([k]) => k).sort(),
      next,
      cycle,
    })
  }
  return trains
}
