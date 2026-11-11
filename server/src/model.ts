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
  type StoredPr,
} from './db.ts'
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

  // --- PR views
  const prs: PrView[] = stored.map(({ pr, relations, release }) => {
    const { body: _body, ...rest } = pr
    const isMine = meSet.has(pr.author.login.toLowerCase())
    const dependsOn = out.get(pr.id) ?? []
    const dependents = inc.get(pr.id) ?? []
    const blocked = pr.state === 'OPEN' && dependsOn.some((e) => !e.satisfied)
    const approvals = pr.reviews.filter((r) => r.state === 'APPROVED').map((r) => r.login)
    const changesRequestedBy = pr.reviews.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.login)
    const reviewRequestedFromMe =
      relations.includes('review_requested') ||
      pr.requestedReviewers.some((r) => !r.isTeam && meSet.has(r.login.toLowerCase()))

    let kind: ActionKind
    let bucket: Bucket
    let detail: string | undefined
    const checksBad = pr.checks.state === 'FAILURE' || pr.checks.state === 'ERROR'
    const waitingOnRelease = dependents.filter((e) => e.kind === 'release' && !e.satisfied)

    if (pr.state === 'CLOSED') {
      ;[kind, bucket] = ['done', 'done']
    } else if (pr.state === 'MERGED') {
      if (waitingOnRelease.length && !release?.released) {
        kind = 'release'
        bucket = isMine || relations.includes('tracked') ? 'action' : 'waiting'
        detail = `${waitingOnRelease.length} PR(s) wait on this release`
      } else if (isMine && release && !release.released) {
        ;[kind, bucket] = ['awaiting_release', 'waiting']
        detail = release.ref ? `not in ${release.ref} yet` : undefined
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
      release,
      dependsOn,
      dependents,
      blocked,
      action: { kind, label: ACTION_LABELS[kind], detail },
      bucket,
      note: m?.note ?? null,
      pinned: m?.pinned ?? false,
      approvals,
      changesRequestedBy,
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
    jira: jiraViews,
    slack,
    stats,
    sync: { ...getSyncState(), running: isSyncing() },
    configured: {
      github: settings.github.accounts.some((a) => a.token),
      jira: !!settings.jira?.apiToken,
      slack: !!settings.slack?.token,
      ai: !!(settings.ai.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
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
