<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, Panel, Position, VueFlow, useVueFlow, type Edge, type EdgeMouseEvent, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import './flowTheme.css'
import { PhGitBranch, PhRocketLaunch } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { isUnreleased } from '@/utils/releaseFlow'
import GraphNode, { CARD_W, cardHeight, type GraphNodeData } from './GraphNode.vue'
import ReleaseGroupNode, { GROUP_W, groupHeight, type GroupRow, type ReleaseGroupData } from './ReleaseGroupNode.vue'
import RepoName from './RepoName.vue'
import ViewMenu, { type ViewSection } from './ViewMenu.vue'
import FilterChips from './FilterChips.vue'

/**
 * Release graph: left to right is the path to production, one lane per repo.
 * Columns: merged to dev (not in a release) → in a release (open release PRs, open hotfixes) →
 * merged to master (not released yet) → released. Releases are boxes listing their PRs; edges show
 * PR dependencies, which release has to go first, and releases that roll into another release.
 */
const deck = useDeck()
const VIEW_DEFAULTS = { repo: '', showUnreleased: true, showHotfixes: true, showReleased: false, mergedDays: '7' }
const v = useLayout().view('releaseGraph', { ...VIEW_DEFAULTS, expanded: {} as Record<string, boolean> })

const COLUMNS = [
  { title: 'Merged to dev', hint: 'Not in a release yet' },
  { title: 'In a release', hint: 'Open release PRs and hotfixes' },
  { title: 'Merged to master', hint: 'Not released yet' },
  { title: 'Released', hint: 'In the latest release' },
] as const
const COLLAPSE_OVER = 8
const LANE_LABEL_W = 200
const COL_W = Math.max(GROUP_W, CARD_W)
const COL_GAP = 140
const STACK_GAP = 24
const LANE_GAP = 72
const HEADER_H = 56
const colX = (c: number) => LANE_LABEL_W + c * (COL_W + COL_GAP)

const repoKey = (p: Pick<PrView, 'repo'>) => p.repo.toLowerCase()
const inScope = (p: PrView) => !v.repo || repoKey(p) === v.repo.toLowerCase()
const columnOf = (p: PrView) => (p.state === 'OPEN' ? 1 : p.release?.released ? 3 : 2)
/** Merged releases and hotfixes older than the chosen window stay off the graph */
const recent = (p: PrView) => p.state === 'OPEN' || (!!p.mergedAt && Date.now() - Date.parse(p.mergedAt) <= Number(v.mergedDays) * 86_400_000)

type Item =
  | { type: 'group'; id: string; col: number; data: ReleaseGroupData; h: number }
  | { type: 'card'; id: string; col: number; pr: PrView; h: number }

/** Everything placed on the graph, per repo lane */
const lanes = computed(() => {
  const byRepo = new Map<string, { repo: string; items: Item[] }>()
  const put = (repo: string, item: Item) => {
    if (item.col === 3 && !v.showReleased) return
    const lane = byRepo.get(repo.toLowerCase()) ?? { repo, items: [] }
    lane.items.push(item)
    byRepo.set(repo.toLowerCase(), lane)
  }
  const group = (data: Omit<ReleaseGroupData, 'expanded' | 'toggle'>, col: number) => {
    // Open releases with few PRs start expanded; merged ones and big ones start collapsed
    const expanded = v.expanded[data.id] ?? (data.rows.length <= COLLAPSE_OVER && (data.kind === 'unreleased' || data.pr?.state === 'OPEN'))
    const full: ReleaseGroupData = { ...data, expanded, toggle: () => (v.expanded[data.id] = !expanded) }
    return { type: 'group' as const, id: data.id, col, data: full, h: groupHeight(full) }
  }

  for (const r of deck.prs.filter((p) => p.flow === 'release' && p.state !== 'CLOSED' && inScope(p) && recent(p))) {
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
    for (const p of deck.prs.filter((p) => isUnreleased(p) && inScope(p))) unreleased.set(p.repo, [...(unreleased.get(p.repo) ?? []), p])
    for (const [repo, prs] of unreleased) {
      const rows = prs.map((p) => ({ id: p.id, title: p.title, url: p.url, pr: p }))
      const keys = [...new Set(prs.flatMap((p) => p.jiraKeys))]
      put(repo, group({ kind: 'unreleased', id: `unreleased:${repo.toLowerCase()}`, repo, branch: prs[0].baseRef, rows, jiraKeys: keys }, 0))
    }
  }
  if (v.showHotfixes)
    for (const p of deck.prs.filter((p) => p.flow === 'hotfix' && p.state !== 'CLOSED' && inScope(p) && recent(p)))
      put(p.repo, { type: 'card', id: p.id, col: columnOf(p), pr: p, h: cardHeight(p, deck.jiraByKey) })

  return [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo))
})

/** Positions: items stacked per column inside each lane; lanes stacked vertically */
const placed = computed(() => {
  const out: { item: Item; x: number; y: number; lane: string }[] = []
  const laneLabels: { repo: string; y: number; h: number }[] = []
  let y = HEADER_H
  for (const lane of lanes.value) {
    const colY = [0, 0, 0, 0]
    const items = [...lane.items].sort((a, b) => a.col - b.col)
    for (const item of items) {
      out.push({ item, x: colX(item.col), y: y + colY[item.col], lane: lane.repo })
      colY[item.col] += item.h + STACK_GAP
    }
    const h = Math.max(...colY) - STACK_GAP
    laneLabels.push({ repo: lane.repo, y, h })
    y += h + LANE_GAP
  }
  return { out, laneLabels }
})
const visibleCols = computed(() => (v.showReleased ? 4 : 3))

/** Where a PR is drawn: its own card, a row in a group, or a collapsed group */
const locate = computed(() => {
  const m = new Map<string, { node: string; handle: (dir: 'in' | 'out') => string | undefined }>()
  for (const { item } of placed.value.out) {
    if (item.type === 'card') m.set(item.id, { node: item.id, handle: () => undefined })
    else {
      if (item.data.pr) m.set(item.id, { node: item.id, handle: (d) => `${d}:group` })
      for (const r of item.data.rows)
        if (!m.has(r.id)) m.set(r.id, { node: item.id, handle: (d) => (item.data.expanded ? `${d}:${r.id}` : `${d}:group`) })
    }
  }
  return m
})
/** Release groups each PR belongs to */
const groupsOf = computed(() => {
  const m = new Map<string, string[]>()
  for (const { item } of placed.value.out)
    if (item.type === 'group' && item.data.kind === 'release') for (const r of item.data.rows) m.set(r.id, [...(m.get(r.id) ?? []), item.id])
  return m
})

const nodes = computed<Node[]>(() => [
  // Column headers and lane labels move with the canvas
  ...COLUMNS.slice(0, visibleCols.value).map((c, i) => ({
    id: `col:${i}`,
    type: 'label',
    position: { x: colX(i), y: 0 },
    data: { title: c.title, hint: c.hint, width: COL_W },
    selectable: false,
    draggable: false,
  })),
  ...placed.value.laneLabels.map((l) => ({
    id: `lane:${l.repo}`,
    type: 'lane',
    position: { x: 0, y: l.y },
    data: { repo: l.repo, height: l.h },
    selectable: false,
    draggable: false,
  })),
  ...placed.value.out.map(({ item, x, y }) =>
    item.type === 'group'
      ? { id: item.id, type: 'group-release', position: { x, y }, data: item.data, draggable: false }
      : {
          id: item.id,
          type: 'pr',
          position: { x, y },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { id: item.id, pr: item.pr, color: 'var(--warning)', isNext: false } satisfies GraphNodeData,
          draggable: false,
        },
  ),
])

const edges = computed<Edge[]>(() => {
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
  // Releases inside releases: inner rolls into outer
  for (const { item } of placed.value.out) {
    if (item.type !== 'group' || item.data.kind !== 'release') continue
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

const { fitView, setViewport, dimensions } = useVueFlow('release-graph')
/** Fit when it stays readable; otherwise start at the top left at a readable zoom and let people pan */
async function frame() {
  await nextTick()
  const ys = placed.value.out.map((o) => o.y + o.item.h)
  const height = Math.max(HEADER_H, ...ys) + 40
  const width = colX(visibleCols.value) + 40
  const zoom = Math.min(dimensions.value.width / width, dimensions.value.height / height)
  setTimeout(() => (zoom >= 0.6 ? fitView({ padding: 0.06, maxZoom: 1, duration: 200 }) : setViewport({ x: 16, y: 16, zoom: 0.8 }, { duration: 200 })), 50)
}
watch(() => nodes.value.map((n) => n.id).join('|'), frame)

function onNodeClick({ node }: NodeMouseEvent) {
  if (node.type === 'pr') deck.selectedId = node.id
}
const tip = ref<{ x: number; y: number; text: string } | null>(null)
function onEdgeHover({ edge, event }: EdgeMouseEvent) {
  const m = event as MouseEvent
  tip.value = { x: m.clientX, y: m.clientY, text: (edge.data as { text: string }).text }
}

const repoOptions = computed(() =>
  [...new Set(deck.prs.filter((p) => p.flow || isUnreleased(p)).map((p) => p.repo))].sort().map((r) => ({ value: r, label: r })),
)
const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'repo', label: 'Repo', icon: PhGitBranch, allLabel: 'All repos', options: repoOptions.value, mono: true },
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
  { type: 'check', key: 'showReleased', label: 'Show released' },
])
const chips = computed(() => (v.repo ? [{ key: 'repo', label: v.repo, clear: () => (v.repo = '') }] : []))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <FilterChips :chips="chips" />
      <span class="flex-1" />
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
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
        @node-click="onNodeClick"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-move="onEdgeHover"
        @edge-mouse-leave="tip = null"
      >
        <template #node-label="p">
          <div :style="{ width: `${p.data.width}px` }" class="pointer-events-none">
            <div class="text-sm font-semibold">{{ p.data.title }}</div>
            <div class="text-xs text-muted-foreground">{{ p.data.hint }}</div>
          </div>
        </template>
        <template #node-lane="p">
          <div class="pointer-events-none w-[170px] border-l-2 border-primary/40 pl-2" :style="{ height: `${p.data.height}px` }">
            <RepoName :repo="p.data.repo" class="font-mono text-xs font-medium" />
          </div>
        </template>
        <template #node-group-release="p">
          <ReleaseGroupNode :data="p.data" />
        </template>
        <template #node-pr="p">
          <GraphNode :data="p.data" />
        </template>

        <Background :gap="18" :size="1.2" />
        <Controls position="bottom-left" :show-interactive="false" />
        <Panel position="bottom-right" class="graph-panel flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--primary)" stroke-width="2.5" /></svg>release goes first</span>
          <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--merged)" stroke-width="1.75" stroke-dasharray="2 4" /></svg>rolls into</span>
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
