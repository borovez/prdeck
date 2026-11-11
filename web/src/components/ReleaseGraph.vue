<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MarkerType, Panel, VueFlow, useVueFlow, type Edge, type EdgeMouseEvent, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import './flowTheme.css'
import { PhArrowsCounterClockwise, PhRocketLaunch } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { isUnreleased } from '@/utils/releaseFlow'
import ReleaseGroupNode, { GROUP_W, groupHeight, type GroupRow, type ReleaseGroupData } from './ReleaseGroupNode.vue'
import RepoName from './RepoName.vue'
import ViewMenu, { type ViewSection } from './ViewMenu.vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Release graph: left to right is the path to production, one lane per repo.
 * Columns: merged to dev (not in a release) → in a release (open release PRs, open hotfixes) →
 * merged to master (not released yet) → released. Releases are boxes listing their PRs; edges show
 * PR dependencies, which release has to go first, and releases that roll into another release.
 */
const deck = useDeck()
const VIEW_DEFAULTS = { showUnreleased: true, showHotfixes: true, showTags: true, mergedDays: '7' }
/** repo: '' = the busiest repo, 'all' = every repo, else a repo (lower case) */
const v = useLayout().view('releaseGraph', { ...VIEW_DEFAULTS, repo: '', expanded: {} as Record<string, boolean> })

const COLUMNS = [
  { title: 'Merged to dev', hint: 'Not in a release yet; backmerges' },
  { title: 'In a release', hint: 'Open release PRs and hotfixes' },
  { title: 'Merged, not released', hint: 'Not in the latest tag yet' },
  { title: 'Released', hint: 'In master/main or the latest tag' },
] as const
const COLLAPSE_OVER = 8
const LANE_LABEL_W = 200
const COL_W = GROUP_W
const COL_GAP = 140
const STACK_GAP = 24
const LANE_GAP = 72
const HEADER_H = 56
/** x of the n-th shown column (empty columns are left out) */
const slotX = (n: number) => LANE_LABEL_W + n * (COL_W + COL_GAP)

const columnOf = (p: PrView) => (p.state === 'OPEN' ? 1 : p.release?.released ? 3 : 2)
/** Merged releases and hotfixes older than the chosen window stay off the graph */
const recent = (p: PrView) => p.state === 'OPEN' || (!!p.mergedAt && Date.now() - Date.parse(p.mergedAt) <= Number(v.mergedDays) * 86_400_000)

interface Item {
  id: string
  col: number
  data: ReleaseGroupData
  h: number
}
interface Lane {
  key: string
  repo: string
  items: Item[]
  /** Shown only for its links to the focused repo */
  linked?: boolean
}
const idsOf = (i: Item) => [...(i.data.pr ? [i.data.pr.id] : []), ...i.data.rows.map((r) => r.id)]

/** Every repo's lane, before focusing on one */
const allLanes = computed<Lane[]>(() => {
  const byRepo = new Map<string, Lane>()
  /** Released releases and hotfixes go into one box per repo, named after the tag */
  const tagged = new Map<string, { repo: string; prs: PrView[] }>()
  const release = (repo: string, p: PrView) => {
    const t = tagged.get(repo.toLowerCase()) ?? { repo, prs: [] }
    t.prs.push(p)
    tagged.set(repo.toLowerCase(), t)
  }
  const put = (repo: string, item: Item) => {
    const key = repo.toLowerCase()
    const lane = byRepo.get(key) ?? { key, repo, items: [] }
    lane.items.push(item)
    byRepo.set(key, lane)
  }
  const group = (data: Omit<ReleaseGroupData, 'expanded' | 'toggle'>, col: number): Item => {
    // Open releases with few PRs start expanded; merged ones and big ones start collapsed
    const expanded = v.expanded[data.id] ?? (data.rows.length <= COLLAPSE_OVER && data.pr?.state !== 'MERGED')
    const full: ReleaseGroupData = { ...data, expanded, toggle: () => (v.expanded[data.id] = !expanded) }
    return { id: data.id, col, data: full, h: groupHeight(full) }
  }

  for (const r of deck.prs.filter((p) => p.flow === 'release' && p.state !== 'CLOSED' && recent(p))) {
    if (columnOf(r) === 3) {
      release(r.repo, r)
      continue
    }
    const c = deck.releaseById.get(r.id)
    const rows: GroupRow[] = (c?.items ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      url: i.url,
      pr: deck.byId.get(i.id),
      via: i.via,
      isRelease: deck.releaseById.has(i.id),
    }))
    put(r.repo, group({ kind: 'release', id: r.id, repo: r.repo, pr: r, branch: `${r.headRef} → ${r.baseRef}`, rows, jiraKeys: c?.jiraKeys ?? [] }, columnOf(r)))
  }
  if (v.showUnreleased) {
    const unreleased = new Map<string, PrView[]>()
    for (const p of deck.prs.filter(isUnreleased)) unreleased.set(p.repo, [...(unreleased.get(p.repo) ?? []), p])
    for (const [repo, prs] of unreleased) {
      const rows = prs.map((p) => ({ id: p.id, title: p.title, url: p.url, pr: p }))
      put(repo, group({ kind: 'unreleased', id: `unreleased:${repo.toLowerCase()}`, repo, branch: prs[0].baseRef, rows, jiraKeys: [...new Set(prs.flatMap((p) => p.jiraKeys))] }, 0))
    }
  }
  if (v.showHotfixes) {
    // One box per repo and column
    const boxes = new Map<string, { repo: string; col: number; prs: PrView[] }>()
    for (const p of deck.prs.filter((p) => p.flow === 'hotfix' && p.state !== 'CLOSED' && recent(p))) {
      if (columnOf(p) === 3) {
        release(p.repo, p)
        continue
      }
      const k = `${p.repo.toLowerCase()}:${columnOf(p)}`
      const box = boxes.get(k) ?? { repo: p.repo, col: columnOf(p), prs: [] }
      box.prs.push(p)
      boxes.set(k, box)
    }
    for (const [k, { repo, col, prs }] of boxes) {
      const rows = prs.map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        pr: p,
        warn: p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged ? `Not in ${p.backmerge.into} yet` : undefined,
      }))
      put(repo, group({ kind: 'hotfixes', id: `hotfixes:${k}`, repo, branch: prs[0].baseRef, rows, jiraKeys: [...new Set(prs.flatMap((p) => p.jiraKeys))] }, col))
    }
  }
  if (v.showTags) {
    // Tag-based repos: the latest tag's contents (what it shipped since the previous tag)
    const latest = new Map<string, NonNullable<typeof deck.overview>['tags'][number]>()
    for (const t of deck.overview?.tags ?? []) if (!latest.has(t.repo.toLowerCase())) latest.set(t.repo.toLowerCase(), t)
    for (const [key, t] of latest) {
      if (tagged.has(key)) continue
      const rows = t.items.map((i) => ({ id: i.id, title: i.title, url: i.url, pr: deck.byId.get(i.id), via: i.via }))
      put(t.repo, group({ kind: 'tag', id: `tag:${key}`, repo: t.repo, branch: t.tag, rows, jiraKeys: t.jiraKeys, tag: { name: t.tag, url: t.url, branch: false } }, 3))
    }
  }
  if (v.showTags)
    for (const [key, { repo, prs }] of tagged) {
      // The tag the merges were checked against (the repo's latest release)
      const ref = prs.find((p) => p.release?.ref)?.release
      const name = ref?.ref ?? null
      const branch = ref?.via === 'branch'
      const rows = prs.map((p) => ({ id: p.id, title: p.title, url: p.url, pr: p, isRelease: p.flow === 'release' }))
      put(
        repo,
        group(
          {
            kind: 'tag',
            id: `tag:${key}`,
            repo,
            branch: name ?? '',
            rows,
            jiraKeys: [...new Set(prs.flatMap((p) => [...p.jiraKeys, ...(deck.releaseById.get(p.id)?.jiraKeys ?? [])]))],
            tag: name
              ? {
                  name,
                  branch,
                  url: branch ? `https://github.com/${repo}/commits/${encodeURIComponent(name)}` : `https://github.com/${repo}/releases/tag/${encodeURIComponent(name)}`,
                }
              : undefined,
          },
          3,
        ),
      )
    }

  // Back into dev: hotfixes not in the integration branch yet, and open backmerge PRs
  if (v.showHotfixes) {
    const repos = new Map<string, { repo: string; into: string; missing: number; open: PrView[] }>()
    const entry = (p: PrView, into: string) => {
      const e = repos.get(p.repo.toLowerCase()) ?? { repo: p.repo, into, missing: 0, open: [] }
      repos.set(p.repo.toLowerCase(), e)
      return e
    }
    for (const p of deck.prs)
      if (p.flow === 'hotfix' && p.state === 'MERGED' && recent(p) && p.backmerge && !p.backmerge.backmerged) entry(p, p.backmerge.into).missing++
    for (const p of deck.prs) if (p.flow === 'backmerge' && p.state === 'OPEN') entry(p, p.baseRef).open.push(p)
    for (const [key, e] of repos) {
      const rows = e.open.map((p) => ({ id: p.id, title: p.title, url: p.url, pr: p }))
      put(e.repo, group({ kind: 'backmerge', id: `backmerge:${key}`, repo: e.repo, branch: e.into, rows, jiraKeys: [], missing: e.missing }, 0))
    }
  }
  return [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo))
})

/** Repo tabs: open releases and open hotfixes per repo */
const repoTabs = computed(() =>
  allLanes.value.map((l) => ({
    key: l.key,
    repo: l.repo,
    count: l.items.reduce((n, i) => n + (i.data.kind === 'release' ? Number(i.data.pr?.state === 'OPEN') : i.data.kind === 'hotfixes' && i.col === 1 ? i.data.rows.length : 0), 0),
  })),
)
const activeRepo = computed(() => {
  if (v.repo === 'all') return 'all'
  if (v.repo && allLanes.value.some((l) => l.key === v.repo)) return v.repo
  return [...repoTabs.value].sort((a, b) => b.count - a.count)[0]?.key ?? 'all'
})

/** The focused repo's lane, plus the parts of other lanes linked to it by dependencies */
const lanes = computed<Lane[]>(() => {
  if (activeRepo.value === 'all') return allLanes.value
  const focus = allLanes.value.find((l) => l.key === activeRepo.value)
  if (!focus) return []
  const own = new Set(focus.items.flatMap(idsOf))
  const linked = new Set<string>()
  for (const e of deck.overview?.edges ?? []) {
    if (own.has(e.from) && !own.has(e.to)) linked.add(e.to)
    if (own.has(e.to) && !own.has(e.from)) linked.add(e.from)
  }
  const others = allLanes.value
    .filter((l) => l !== focus)
    .map((l) => ({ ...l, linked: true, items: l.items.filter((i) => idsOf(i).some((id) => linked.has(id))) }))
    .filter((l) => l.items.length)
  return [focus, ...others]
})

/** Positions: items stacked per column inside each lane; lanes stacked vertically */
const placed = computed(() => {
  const out: { item: Item; x: number; y: number; lane: string }[] = []
  const laneLabels: { repo: string; y: number; h: number; linked?: boolean }[] = []
  let y = HEADER_H
  for (const lane of lanes.value) {
    const colY = [0, 0, 0, 0]
    const items = [...lane.items].sort((a, b) => a.col - b.col)
    for (const item of items) {
      out.push({ item, x: slotX(shownCols.value.indexOf(item.col)), y: y + colY[item.col], lane: lane.repo })
      colY[item.col] += item.h + STACK_GAP
    }
    const h = Math.max(...colY) - STACK_GAP
    laneLabels.push({ repo: lane.repo, y, h, linked: lane.linked })
    y += h + LANE_GAP
  }
  return { out, laneLabels }
})
/** Columns with something in them for the current repo / filters */
const shownCols = computed(() => [0, 1, 2, 3].filter((c) => lanes.value.some((l) => l.items.some((i) => i.col === c))))

/** Where a PR is drawn: its own card, a row in a group, or a collapsed group */
const locate = computed(() => {
  const m = new Map<string, { node: string; handle: (dir: 'in' | 'out') => string | undefined }>()
  for (const { item } of placed.value.out) {
    if (item.data.pr) m.set(item.id, { node: item.id, handle: (d) => `${d}:group` })
    for (const r of item.data.rows)
      if (!m.has(r.id)) m.set(r.id, { node: item.id, handle: (d) => (item.data.expanded ? `${d}:${r.id}` : `${d}:group`) })
  }
  return m
})
/** Release groups each PR belongs to */
const groupsOf = computed(() => {
  const m = new Map<string, string[]>()
  for (const { item } of placed.value.out)
    if (item.data.kind === 'release') for (const r of item.data.rows) m.set(r.id, [...(m.get(r.id) ?? []), item.id])
  return m
})

const nodes = computed<Node[]>(() => [
  // Column headers and lane labels move with the canvas
  ...shownCols.value.map((col, i) => ({
    id: `col:${col}`,
    type: 'label',
    position: { x: slotX(i), y: 0 },
    data: { title: COLUMNS[col].title, hint: COLUMNS[col].hint, width: COL_W },
    selectable: false,
    draggable: false,
  })),
  ...placed.value.laneLabels.map((l) => ({
    id: `lane:${l.repo}`,
    type: 'lane',
    position: { x: 0, y: l.y },
    data: { repo: l.repo, height: l.h, linked: l.linked },
    selectable: false,
    draggable: false,
  })),
  ...placed.value.out.map(({ item, x, y }) => ({ id: item.id, type: 'group-release', position: { x, y }, data: item.data, draggable: false, zIndex: 10 })),
])

const baseEdges = computed<Edge[]>(() => {
  const out = new Map<string, Edge>()
  const loc = locate.value
  // PR dependencies (prerequisite → dependent)
  for (const e of deck.overview?.edges ?? []) {
    const a = loc.get(e.to)
    const b = loc.get(e.from)
    if (!a || !b || a.node === b.node) continue
    const color = e.satisfied ? 'var(--success)' : 'var(--warning)'
    const id = `dep:${e.to}->${e.from}`
    out.set(id, {
      id,
      source: a.node,
      sourceHandle: a.handle('out'),
      target: b.node,
      targetHandle: b.handle('in'),
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: e.kind === 'release' ? '6 4' : undefined, opacity: e.satisfied ? 0.55 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      data: { text: `${e.to} must be ${e.kind === 'release' ? 'released' : 'merged'} before ${e.from}${e.satisfied ? ' (done)' : ''}` },
    })
    // Release order: the release holding the prerequisite goes before the one holding the dependent
    for (const ga of groupsOf.value.get(e.to) ?? [])
      for (const gb of groupsOf.value.get(e.from) ?? []) {
        if (ga === gb) continue
        const first = deck.byId.get(ga)
        const done = first?.state === 'MERGED'
        const oid = `order:${ga}->${gb}`
        if (out.has(oid)) continue
        out.set(oid, {
          id: oid,
          source: ga,
          sourceHandle: 'out:group',
          target: gb,
          targetHandle: 'in:group',
          type: 'smoothstep',
          label: 'goes first',
          style: { stroke: done ? 'var(--success)' : 'var(--primary)', strokeWidth: 2.5 },
          labelStyle: { fill: 'var(--foreground)', fontSize: '11px' },
          labelBgStyle: { fill: 'var(--card)' },
          markerEnd: { type: MarkerType.ArrowClosed, color: done ? 'var(--success)' : 'var(--primary)', width: 16, height: 16 },
          data: { text: `${ga} has to ship before ${gb}: a PR in it is a prerequisite${done ? ' (merged)' : ''}` },
        })
      }
  }
  // Hotfixes not back in dev: an edge back to the repo's "Back into dev" box (to its open backmerge PR if any)
  for (const { item } of placed.value.out) {
    if (item.data.kind !== 'hotfixes') continue
    const target = `backmerge:${item.data.repo.toLowerCase()}`
    if (!placed.value.out.some((o) => o.item.id === target)) continue
    const bm = placed.value.out.find((o) => o.item.id === target)!.item
    for (const r of item.data.rows) {
      const p = r.pr
      if (!p || p.state !== 'MERGED' || !p.backmerge || p.backmerge.backmerged) continue
      const open = p.backmergePr && bm.data.expanded && bm.data.rows.some((x) => x.id === p.backmergePr) ? p.backmergePr : null
      const color = p.backmergePr ? 'var(--warning)' : 'var(--destructive)'
      const id = `back:${r.id}`
      out.set(id, {
        id,
        source: item.id,
        sourceHandle: item.data.expanded ? `back:${r.id}` : 'back:group',
        target,
        targetHandle: open ? `back-in:${open}` : 'back-in:group',
        type: 'smoothstep',
        label: p.backmergePr ? 'backmerge open' : `not in ${p.backmerge.into}`,
        labelStyle: { fill: color, fontSize: '11px' },
        labelBgStyle: { fill: 'var(--card)' },
        style: { stroke: color, strokeWidth: 1.75, strokeDasharray: '6 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        data: {
          text: p.backmergePr
            ? `${r.id} is not in ${p.backmerge.into} yet; backmerge ${p.backmergePr} is open`
            : `${r.id} is not in ${p.backmerge.into} yet: merge ${p.baseRef} back into ${p.backmerge.into}`,
        },
      })
    }
  }

  // Release trains: releases in different repos that ship the same Jira issues (no order implied)
  const placedIds = new Set(placed.value.out.map((o) => o.item.id))
  for (const t of deck.overview?.trains ?? [])
    for (const l of t.links) {
      if (l.kind !== 'jira' || !placedIds.has(l.from) || !placedIds.has(l.to)) continue
      const id = `jira:${l.from}|${l.to}`
      out.set(id, {
        id,
        source: l.from,
        sourceHandle: 'out:group',
        target: l.to,
        targetHandle: 'in:group',
        type: 'smoothstep',
        label: 'same Jira',
        labelStyle: { fill: 'var(--info)', fontSize: '11px' },
        labelBgStyle: { fill: 'var(--card)' },
        style: { stroke: 'var(--info)', strokeWidth: 1.5, strokeDasharray: '1 5', strokeLinecap: 'round' },
        data: { text: `Release train: ${l.from} and ${l.to} ${l.reasons.join('; ')}` },
      })
    }

  // Releases inside releases: inner rolls into outer
  for (const { item } of placed.value.out) {
    if (item.data.kind !== 'release') continue
    for (const r of item.data.rows) {
      if (!r.isRelease || !loc.has(r.id) || loc.get(r.id)!.node === item.id) continue
      const id = `rolls:${r.id}->${item.id}`
      out.set(id, {
        id,
        source: r.id,
        sourceHandle: 'out:group',
        target: item.id,
        targetHandle: item.data.expanded ? `in:${r.id}` : 'in:group',
        type: 'smoothstep',
        style: { stroke: 'var(--merged)', strokeWidth: 1.75, strokeDasharray: '2 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--merged)', width: 14, height: 14 },
        data: { text: `${r.id} rolls into ${item.id}` },
      })
    }
  }
  return [...out.values()]
})

/** Hovering an edge, or a box, brings its edges forward and fades the rest */
const hoverEdge = ref<string | null>(null)
const hoverNode = ref<string | null>(null)
const edges = computed<Edge[]>(() => {
  const active = (e: Edge) => e.id === hoverEdge.value || (!!hoverNode.value && (e.source === hoverNode.value || e.target === hoverNode.value))
  if (!hoverEdge.value && !hoverNode.value) return baseEdges.value
  return baseEdges.value.map((e) => {
    const on = active(e)
    const style = (e.style ?? {}) as Record<string, unknown>
    return {
      ...e,
      zIndex: on ? 5 : 0, // still below the boxes (zIndex 10)
      animated: on,
      style: { ...style, opacity: on ? 1 : 0.15, strokeWidth: Number(style.strokeWidth ?? 1.5) + (on ? 1.5 : 0) },
    }
  })
})

const { fitView, setViewport, dimensions } = useVueFlow('release-graph')
/** Fit when it stays readable; otherwise start at the top left at a readable zoom and let people pan */
/** ?focus=<pr id>: zoom to the box holding that PR (set by the PR panel's "Show in release graph") */
const route = useRoute()
const router = useRouter()
async function frame() {
  await nextTick()
  const focus = typeof route.query.focus === 'string' ? route.query.focus : null
  const node = focus ? locate.value.get(focus)?.node : undefined
  if (node) {
    setTimeout(() => fitView({ nodes: [node], maxZoom: 1, minZoom: 0.6, padding: 0.3, duration: 300 }), 80)
    router.replace({ query: {} })
    return
  }
  const ys = placed.value.out.map((o) => o.y + o.item.h)
  const height = Math.max(HEADER_H, ...ys) + 40
  const width = slotX(shownCols.value.length) + 40
  const zoom = Math.min(dimensions.value.width / width, dimensions.value.height / height)
  setTimeout(() => (zoom >= 0.6 ? fitView({ padding: 0.06, maxZoom: 1, duration: 200 }) : setViewport({ x: 16, y: 16, zoom: 0.8 }, { duration: 200 })), 50)
}
watch(() => nodes.value.map((n) => n.id).join('|'), frame)
watch(() => route.query.focus, (f) => f && frame())

const tip = ref<{ x: number; y: number; text: string } | null>(null)
function onEdgeHover({ edge, event }: EdgeMouseEvent) {
  hoverEdge.value = edge.id
  const m = event as MouseEvent
  tip.value = { x: m.clientX, y: m.clientY, text: (edge.data as { text: string }).text }
}

const viewSections = computed<ViewSection[]>(() => [
  {
    type: 'radio',
    key: 'mergedDays',
    label: 'Merged releases and hotfixes from',
    options: [
      { value: '3', label: 'Last 3 days' },
      { value: '7', label: 'Last 7 days' },
      { value: '14', label: 'Last 14 days' },
      { value: '90', label: 'Everything synced' },
    ],
  },
  { type: 'check', key: 'showUnreleased', label: 'Show merged work not in a release' },
  { type: 'check', key: 'showHotfixes', label: 'Show hotfixes' },
  { type: 'check', key: 'showTags', label: 'Show released (latest tag)' },
])
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!-- Filters live in the page toolbar, next to the tabs -->
    <Teleport defer to="#releases-toolbar">
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
    </Teleport>
    <!-- One repo at a time; other repos show only what links to it -->
    <div v-if="repoTabs.length > 1" class="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
      <Tabs :model-value="activeRepo" @update:model-value="(r) => (v.repo = String(r))">
        <TabsList>
          <TabsTrigger v-for="r in repoTabs" :key="r.key" :value="r.key" :count="r.count" :title="r.repo">{{ r.repo.split('/')[1] }}</TabsTrigger>
          <TabsTrigger value="all">All repos</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <div class="relative min-h-0 flex-1 overflow-hidden rounded-xl border">
      <VueFlow
        id="release-graph"
        class="dep-graph release-graph"
        :nodes="nodes"
        :edges="edges"
        :nodes-connectable="false"
        :nodes-focusable="false"
        :elements-selectable="false"
        :min-zoom="0.15"
        :max-zoom="1.5"
        @pane-ready="frame"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-move="onEdgeHover"
        @edge-mouse-leave="(tip = null), (hoverEdge = null)"
        @node-mouse-enter="({ node }) => (hoverNode = node.type === 'group-release' ? node.id : null)"
        @node-mouse-leave="hoverNode = null"
      >
        <template #node-label="p">
          <div :style="{ width: `${p.data.width}px` }" class="pointer-events-none">
            <div class="text-sm font-semibold">{{ p.data.title }}</div>
            <div class="text-xs text-muted-foreground">{{ p.data.hint }}</div>
          </div>
        </template>
        <template #node-lane="p">
          <div class="pointer-events-none w-[170px] border-l-2 pl-2" :class="p.data.linked ? 'border-dashed border-muted-foreground/40' : 'border-primary/40'" :style="{ height: `${p.data.height}px` }">
            <RepoName :repo="p.data.repo" class="font-mono text-xs font-medium" />
            <div v-if="p.data.linked" class="text-[11px] text-muted-foreground">Only what links to the selected repo</div>
          </div>
        </template>
        <template #node-group-release="p">
          <ReleaseGroupNode :data="p.data" />
        </template>

        <Background :gap="18" :size="1.2" />
        <Controls position="bottom-left" :show-interactive="false" :show-fit-view="false">
          <ControlButton title="Reset view" aria-label="Reset view" @click="frame"><PhArrowsCounterClockwise /></ControlButton>
        </Controls>
        <Panel position="bottom-right" class="graph-panel flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--primary)" stroke-width="2.5" /></svg>release goes first</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--merged)" stroke-width="1.75" stroke-dasharray="2 4" /></svg>rolls into</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--info)" stroke-width="1.5" stroke-dasharray="1 5" stroke-linecap="round" /></svg>same Jira</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--destructive)" stroke-width="1.75" stroke-dasharray="6 4" /></svg>back into dev</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.5" /></svg>needs merge</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 4" /></svg>needs release</span>
        </Panel>
      </VueFlow>
      <div v-if="!lanes.length" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <PhRocketLaunch :size="40" weight="duotone" class="text-primary" />
        <div class="text-sm font-medium text-foreground">Nothing on the way to production</div>
        <p class="max-w-md text-xs">Release PRs (dev → master/main, release/* → master/main), hotfixes and merged work show up here.</p>
      </div>
      <Teleport to="body">
        <div
          v-if="tip"
          class="pointer-events-none fixed z-50 w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
          :style="{ left: `${tip.x}px`, top: `${tip.y - 10}px` }"
        >
          {{ tip.text }}
        </div>
      </Teleport>
    </div>
  </div>
</template>

<style>
.release-graph .vue-flow__node-group-release,
.release-graph .vue-flow__node-label,
.release-graph .vue-flow__node-lane {
  padding: 0;
  border: 0;
  background: transparent;
  width: auto;
  box-shadow: none;
}
.release-graph .vue-flow__node-label,
.release-graph .vue-flow__node-lane {
  cursor: default;
}
.release-graph .rg-handle {
  width: 6px;
  height: 6px;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
}
.release-graph .vue-flow__edge-text {
  font-weight: 500;
}
</style>
