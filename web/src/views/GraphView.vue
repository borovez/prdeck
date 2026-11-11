<script setup lang="ts">
import { onEscape } from '@/composables/escape'
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, Panel, Position, VueFlow, useVueFlow, type Connection, type Edge, type EdgeMouseEvent, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import dagre from '@dagrejs/dagre'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@/components/flowTheme.css'
import { PhArrowsCounterClockwise, PhBuildings, PhGitBranch, PhGraph, PhHandGrabbing, PhTrash, PhX } from '@phosphor-icons/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DepEdge, DependencyKind, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useDependencies } from '@/composables/dependencies'
import { useLayout } from '@/stores/layout'
import GraphNode, { CARD_W, cardHeight, type GraphNodeData } from '@/components/GraphNode.vue'
import FilterChips from '@/components/FilterChips.vue'
import ViewMenu, { type ViewSection } from '@/components/ViewMenu.vue'
import RepoName from '@/components/RepoName.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const deck = useDeck()
const deps = useDependencies()
// Escape: the PR drawer closes first (its own handler), then the edge panel
onEscape(() => !deck.selectedId && !!selectedEdge.value && ((selectedEdge.value = null), true))
const layout = useLayout()
/** View options in the View menu, and their defaults (Reset view) */
const VIEW_DEFAULTS = {
  org: '',
  repo: '',
  hideDone: true,
  mineOnly: false,
  /** Also show open PRs that have no dependencies yet, so new links can be drawn to them */
  showUnlinked: false,
}
const v = layout.view('graph', { ...VIEW_DEFAULTS, newKind: 'merge' as DependencyKind })

const NODE_W = CARD_W
const nodeHeight = (id: string) => cardHeight(deck.byId.get(id), deck.jiraByKey)
const SOURCE_LABEL: Record<DepEdge['source'], string> = { manual: 'Added manually', body: 'From PR description', jira: 'From Jira "is blocked by"' }
const ORG_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--merged)', 'var(--info)']

const ownerOf = (id: string) => id.split('/')[0]
const repoOf = (id: string) => id.split('#')[0]

const allEdges = computed(() => deck.overview?.edges ?? [])
const orgs = computed(() => {
  const ids = new Set<string>([...deck.prs.map((p) => p.id), ...allEdges.value.flatMap((e) => [e.from, e.to])])
  return [...new Set([...ids].map(ownerOf))].sort()
})
const orgColor = computed(() => new Map(orgs.value.map((o, i) => [o, ORG_COLORS[i % ORG_COLORS.length]])))
const repos = computed(() => {
  const all = new Set<string>([...deck.repos, ...allEdges.value.flatMap((e) => [repoOf(e.from), repoOf(e.to)])])
  return [...all].filter((r) => !v.org || ownerOf(r) === v.org).sort()
})

const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'org', label: 'Org', icon: PhBuildings, allLabel: 'All orgs', options: orgs.value.map((o) => ({ value: o, label: o })), mono: true },
  { type: 'filter', key: 'repo', label: 'Repo', icon: PhGitBranch, allLabel: 'All repos', options: repos.value.map((r) => ({ value: r, label: r })), mono: true },
  { type: 'check', key: 'hideDone', label: 'Hide finished chains' },
  { type: 'check', key: 'mineOnly', label: 'Only chains with my PRs' },
  { type: 'check', key: 'showUnlinked', label: 'Show unlinked PRs (to draw links)' },
])
/** Active filters that aren't otherwise visible in the toolbar */
const chips = computed(() => [
  ...(v.org ? [{ key: 'org', label: v.org, clear: () => (v.org = '') }] : []),
  ...(v.repo ? [{ key: 'repo', label: v.repo, clear: () => (v.repo = '') }] : []),
])
// A repo outside the chosen org would hide everything
watch(() => v.org, (org) => org && v.repo && ownerOf(v.repo) !== org && (v.repo = ''))

const matchesScope = (id: string) => (!v.org || ownerOf(id) === v.org) && (!v.repo || repoOf(id) === v.repo)

const visibleChains = computed(() =>
  (deck.overview?.chains ?? []).filter(
    (c) =>
      (!v.hideDone || !c.done) &&
      (!v.mineOnly || c.prs.some((id) => deck.byId.get(id)?.isMine)) &&
      c.prs.some(matchesScope),
  ),
)

const nextSteps = computed(() => new Set(visibleChains.value.map((c) => c.nextStep).filter(Boolean) as string[]))

const nodeIds = computed(() => {
  const ids = new Set(visibleChains.value.flatMap((c) => c.prs))
  if (v.showUnlinked)
    for (const p of deck.prs)
      if (p.state === 'OPEN' && !ids.has(p.id) && matchesScope(p.id) && (!v.mineOnly || p.isMine)) ids.add(p.id)
  return [...ids]
})

const visibleEdges = computed(() => {
  const ids = new Set(nodeIds.value)
  return allEdges.value.filter((e) => ids.has(e.from) && ids.has(e.to))
})

/** Dagre LR layout. Prerequisites on the left, dependents to the right. */
const positions = computed(() => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of nodeIds.value) g.setNode(id, { width: NODE_W, height: nodeHeight(id) })
  for (const e of visibleEdges.value) g.setEdge(e.to, e.from)
  dagre.layout(g)
  return new Map(nodeIds.value.map((id) => {
    const n = g.node(id)
    return [id, { x: n.x - NODE_W / 2, y: n.y - n.height / 2 }]
  }))
})

const nodes = computed<Node<GraphNodeData>[]>(() =>
  nodeIds.value.map((id) => ({
    id,
    type: 'pr',
    position: positions.value.get(id)!,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { id, pr: deck.byId.get(id) ?? null, color: orgColor.value.get(ownerOf(id)) ?? 'var(--muted-foreground)', isNext: nextSteps.value.has(id) },
  })),
)

const edgeKey = (e: DepEdge) => `${e.kind}:${e.to}->${e.from}`
const hoveredEdge = ref<string | null>(null)
const selectedEdge = ref<DepEdge | null>(null)

const edges = computed<Edge[]>(() =>
  visibleEdges.value.map((e) => {
    const key = edgeKey(e)
    const color = e.satisfied ? 'var(--success)' : 'var(--warning)'
    const active = hoveredEdge.value === key || (selectedEdge.value && edgeKey(selectedEdge.value) === key)
    return {
      id: key,
      source: e.to,
      target: e.from,
      type: 'smoothstep',
      animated: !e.satisfied && nextSteps.value.has(e.to),
      style: {
        stroke: color,
        strokeWidth: active ? 2.5 : 1.75,
        strokeDasharray: e.kind === 'release' ? '6 4' : undefined,
        opacity: e.satisfied ? 0.55 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: e,
    }
  }),
)

const { fitView } = useVueFlow('dep-graph')
// Re-fit when the set of nodes changes (filters, new links), not on every poll
watch(
  () => nodeIds.value.join('|'),
  () => resetView(),
)
/** The position and zoom the graph opens with (also the Reset view button) */
async function resetView() {
  await nextTick()
  setTimeout(() => fitView({ padding: 0.15, maxZoom: 1.25, duration: 200 }), 50)
}

function onNodeClick({ node }: NodeMouseEvent) {
  if (deck.byId.has(node.id)) deck.selectedId = node.id
  else {
    const [repo, n] = node.id.split('#')
    window.open(`https://github.com/${repo}/pull/${n}`, '_blank', 'noopener')
  }
}
const onEdgeClick = ({ edge }: EdgeMouseEvent) => (selectedEdge.value = edge.data as DepEdge)
// Hover tooltip: HTML above the canvas (an SVG edge label sits under the nodes and gets clipped)
const tip = ref<{ x: number; y: number; text: string } | null>(null)
function onEdgeHover({ edge, event }: EdgeMouseEvent) {
  hoveredEdge.value = edge.id
  const e = edge.data as DepEdge
  const m = event as MouseEvent
  tip.value = {
    x: m.clientX,
    y: m.clientY,
    text: `${e.kind === 'release' ? 'Needs release' : 'Needs merge'} · ${SOURCE_LABEL[e.source]}${e.satisfied ? ' · satisfied' : ''}`,
  }
}
function onEdgeLeave() {
  hoveredEdge.value = null
  tip.value = null
}

const busy = ref(false)

/** Drag from prerequisite (right handle) to dependent (left handle). */
function onConnect(c: Connection) {
  if (!c.source || !c.target || c.source === c.target) return
  busy.value = true
  deps.add(c.target, c.source, v.newKind).finally(() => (busy.value = false))
}

async function deleteSelected() {
  const e = selectedEdge.value
  if (!e || !deps.canRemove(e)) return
  busy.value = true
  const ok = await deps.remove(e)
  busy.value = false
  if (ok) selectedEdge.value = null
}

// Drop the selection when the edge disappears after a reload
watch(edges, (es) => {
  if (selectedEdge.value && !es.some((e) => e.id === edgeKey(selectedEdge.value!))) selectedEdge.value = null
})

const titleOf = (id: string) => deck.byId.get(id)?.title
const prOf = (id: string): PrView | undefined => deck.byId.get(id)
const legendOrgs = computed(() => [...new Set(nodeIds.value.map(ownerOf))].sort())
const hasAnyEdges = computed(() => allEdges.value.length > 0)
</script>

<template>
  <div class="h-page flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <FilterChips :chips="chips" />
      <span class="flex-1" />
      <!-- Kind of dependency created by dragging from one card's right dot to another card's left dot -->
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="flex cursor-help items-center gap-1 text-xs text-muted-foreground"><PhHandGrabbing :size="14" />Drag a link: next PR waits for its</span>
        </TooltipTrigger>
        <TooltipContent class="max-w-72">
          Drag from a card's right dot to another card's left dot to add a dependency. The card on the right then waits for the one
          on the left to be merged, or to be released.
        </TooltipContent>
      </Tooltip>
      <ToggleGroup :model-value="v.newKind" type="single" @update:model-value="(k) => k && (v.newKind = k as DependencyKind)" variant="outline" size="sm" aria-label="Kind of dependency for new links">
        <ToggleGroupItem value="merge">merge</ToggleGroupItem>
        <ToggleGroupItem value="release">release</ToggleGroupItem>
      </ToggleGroup>
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
    </div>

    <Card class="relative min-h-0 flex-1 overflow-hidden py-0">
      <VueFlow
        id="dep-graph"
        class="dep-graph"
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="true"
        :nodes-connectable="true"
        :nodes-focusable="false"
        :elements-selectable="true"
        :delete-key-code="null"
        :min-zoom="0.2"
        :max-zoom="2"
        fit-view-on-init
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-move="onEdgeHover"
        @edge-mouse-leave="onEdgeLeave"
        @pane-click="selectedEdge = null"
        @connect="onConnect"
      >
        <template #node-pr="p">
          <GraphNode :data="p.data" :selected="p.selected" />
        </template>

        <Background :gap="18" :size="1.2" />
        <Controls position="bottom-left" :show-interactive="false" :show-fit-view="false">
          <ControlButton title="Reset view" aria-label="Reset view" @click="resetView"><PhArrowsCounterClockwise /></ControlButton>
        </Controls>

        <Panel v-if="legendOrgs.length" position="top-left" class="graph-panel flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs">
          <span v-for="o in legendOrgs" :key="o" class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ background: orgColor.get(o) }" />{{ o }}
          </span>
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.75" /></svg>merge
          </span>
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.75" stroke-dasharray="6 4" /></svg>release
          </span>
        </Panel>

        <Panel v-if="selectedEdge" position="top-right" class="graph-panel w-80 space-y-2 p-3 text-sm">
          <div class="flex items-center gap-2">
            <Badge :variant="selectedEdge.satisfied ? 'success' : 'warning'">{{ selectedEdge.satisfied ? 'Satisfied' : 'Waiting' }}</Badge>
            <Badge variant="muted">{{ selectedEdge.kind === 'release' ? 'Needs release' : 'Needs merge' }}</Badge>
            <span class="flex-1" />
            <Button variant="ghost" size="icon-sm" @click="selectedEdge = null"><PhX /></Button>
          </div>
          <div class="space-y-1 text-xs">
            <div>
              <span class="text-muted-foreground">Prerequisite</span>
              <button class="block w-full text-left hover:underline" @click="prOf(selectedEdge.to) && (deck.selectedId = selectedEdge.to)">
                <RepoName :id="selectedEdge.to" class="font-mono text-primary" />
                <span class="block truncate text-muted-foreground">{{ titleOf(selectedEdge.to) ?? (selectedEdge.missing ? '(not synced yet)' : '') }}</span>
              </button>
            </div>
            <div>
              <span class="text-muted-foreground">Dependent</span>
              <button class="block w-full text-left hover:underline" @click="deck.selectedId = selectedEdge.from">
                <RepoName :id="selectedEdge.from" class="font-mono text-primary" />
                <span class="block truncate text-muted-foreground">{{ titleOf(selectedEdge.from) }}</span>
              </button>
            </div>
            <div class="text-muted-foreground">{{ SOURCE_LABEL[selectedEdge.source] }}<template v-if="selectedEdge.note"> · {{ selectedEdge.note }}</template></div>
          </div>
          <Button v-if="deps.canRemove(selectedEdge)" variant="destructive" size="sm" class="w-full" :disabled="busy" @click="deleteSelected">
            <PhTrash />{{ selectedEdge.source === 'body' ? 'Remove from the PR description' : 'Remove dependency' }}
          </Button>
          <p v-else class="text-xs text-muted-foreground">
            Remove the link in Jira to drop this one.
          </p>
        </Panel>

      </VueFlow>

      <div v-if="!nodeIds.length" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <PhGraph :size="40" weight="duotone" class="text-primary" />
        <div class="text-sm font-medium text-foreground">{{ hasAnyEdges ? 'No chains match these filters' : 'No dependencies yet' }}</div>
        <p class="max-w-md text-xs">
          <template v-if="hasAnyEdges">Try clearing the org/repo filter or showing finished chains.</template>
          <template v-else>
            Add <code class="font-mono">Depends on: owner/repo#123</code> to a PR description, link Jira issues with "is blocked by", or turn on
            <span class="font-medium">Unlinked PRs</span> and drag from one card's right handle to another's left handle.
          </template>
        </p>
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
    </Card>
  </div>
</template>
