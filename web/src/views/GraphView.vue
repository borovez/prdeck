<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, Panel, Position, VueFlow, useVueFlow, type Connection, type Edge, type EdgeMouseEvent, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import dagre from '@dagrejs/dagre'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { PhGraph, PhTrash, PhX } from '@phosphor-icons/vue'
import type { DepEdge, DependencyKind, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { api } from '@/api'
import { shortId } from '@/utils/format'
import GraphNode, { type GraphNodeData } from '@/components/GraphNode.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const deck = useDeck()
const layout = useLayout()
const v = layout.view('graph', {
  org: '',
  repo: '',
  hideDone: true,
  mineOnly: false,
  /** Also show open PRs that have no dependencies yet, so new links can be drawn to them */
  showUnlinked: false,
  newKind: 'merge' as DependencyKind,
})

const NODE_W = 264
const NODE_H = 96
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
  for (const id of nodeIds.value) g.setNode(id, { width: NODE_W, height: NODE_H })
  for (const e of visibleEdges.value) g.setEdge(e.to, e.from)
  dagre.layout(g)
  return new Map(nodeIds.value.map((id) => {
    const n = g.node(id)
    return [id, { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 }]
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
      label: active ? `${e.kind === 'release' ? 'Release' : 'Merge'} · ${SOURCE_LABEL[e.source]}` : undefined,
      labelStyle: { fill: 'var(--popover-foreground)', fontSize: '11px', fontWeight: 500 },
      labelBgStyle: { fill: 'var(--popover)', stroke: 'var(--border)' },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
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
  async () => {
    await nextTick()
    setTimeout(() => fitView({ padding: 0.15, maxZoom: 1.25, duration: 200 }), 50)
  },
)

function onNodeClick({ node }: NodeMouseEvent) {
  if (deck.byId.has(node.id)) deck.selectedId = node.id
  else {
    const [repo, n] = node.id.split('#')
    window.open(`https://github.com/${repo}/pull/${n}`, '_blank', 'noopener')
  }
}
const onEdgeClick = ({ edge }: EdgeMouseEvent) => (selectedEdge.value = edge.data as DepEdge)
const onEdgeEnter = ({ edge }: EdgeMouseEvent) => (hoveredEdge.value = edge.id)
const onEdgeLeave = () => (hoveredEdge.value = null)

const busy = ref(false)
const actionError = ref<string | null>(null)
async function run(fn: () => Promise<unknown>) {
  busy.value = true
  actionError.value = null
  try {
    await deck.mutate(fn)
  } catch (e) {
    actionError.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

/** Drag from prerequisite (right handle) to dependent (left handle). */
function onConnect(c: Connection) {
  if (!c.source || !c.target || c.source === c.target) return
  run(() => api.addDep(c.target, c.source, v.newKind))
}

async function deleteSelected() {
  const e = selectedEdge.value
  if (e?.id == null) return
  await run(() => api.removeDep(e.id!))
  if (!actionError.value) selectedEdge.value = null
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
  <div class="flex h-[calc(100svh-5.5rem)] flex-col gap-3 lg:h-[calc(100svh-6.5rem)]">
    <div class="flex flex-wrap items-center gap-2">
      <NativeSelect v-model="v.org" size="sm" @update:model-value="v.repo = ''">
        <NativeSelectOption value="">All orgs</NativeSelectOption>
        <NativeSelectOption v-for="o in orgs" :key="o" :value="o">{{ o }}</NativeSelectOption>
      </NativeSelect>
      <NativeSelect v-model="v.repo" size="sm">
        <NativeSelectOption value="">All repos</NativeSelectOption>
        <NativeSelectOption v-for="r in repos" :key="r" :value="r">{{ r }}</NativeSelectOption>
      </NativeSelect>
      <Label class="gap-2 font-normal"><Switch v-model="v.hideDone" /> Hide finished</Label>
      <Label class="gap-2 font-normal"><Switch v-model="v.mineOnly" /> Only mine</Label>
      <Label class="gap-2 font-normal" title="Show open PRs without dependencies, so you can drag links to them">
        <Switch v-model="v.showUnlinked" /> Unlinked PRs
      </Label>
      <span class="flex-1" />
      <span class="text-xs text-muted-foreground">New links</span>
      <ToggleGroup v-model="v.newKind" type="single" variant="outline" size="sm">
        <ToggleGroupItem value="merge">Merge</ToggleGroupItem>
        <ToggleGroupItem value="release">Release</ToggleGroupItem>
      </ToggleGroup>
    </div>

    <Card class="relative min-h-0 flex-1 overflow-hidden py-0">
      <VueFlow
        id="dep-graph"
        class="dep-graph"
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="true"
        :nodes-connectable="true"
        :elements-selectable="true"
        :delete-key-code="null"
        :min-zoom="0.2"
        :max-zoom="2"
        fit-view-on-init
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @edge-mouse-enter="onEdgeEnter"
        @edge-mouse-leave="onEdgeLeave"
        @pane-click="selectedEdge = null"
        @connect="onConnect"
      >
        <template #node-pr="p">
          <GraphNode :data="p.data" :selected="p.selected" />
        </template>

        <Background :gap="18" :size="1.2" />
        <Controls position="bottom-left" :show-interactive="false" />

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
              <button class="block max-w-full truncate font-mono text-primary hover:underline" @click="prOf(selectedEdge.to) && (deck.selectedId = selectedEdge.to)">
                {{ shortId(selectedEdge.to) }} <span class="font-sans text-muted-foreground">{{ titleOf(selectedEdge.to) ?? (selectedEdge.missing ? '(not synced yet)' : '') }}</span>
              </button>
            </div>
            <div>
              <span class="text-muted-foreground">Dependent</span>
              <button class="block max-w-full truncate font-mono text-primary hover:underline" @click="deck.selectedId = selectedEdge.from">
                {{ shortId(selectedEdge.from) }} <span class="font-sans text-muted-foreground">{{ titleOf(selectedEdge.from) }}</span>
              </button>
            </div>
            <div class="text-muted-foreground">{{ SOURCE_LABEL[selectedEdge.source] }}<template v-if="selectedEdge.note"> · {{ selectedEdge.note }}</template></div>
          </div>
          <Button v-if="selectedEdge.id != null" variant="destructive" size="sm" class="w-full" :disabled="busy" @click="deleteSelected">
            <PhTrash />Remove dependency
          </Button>
          <p v-else class="text-xs text-muted-foreground">
            {{ selectedEdge.source === 'body' ? 'Edit the PR description to remove this link.' : 'Remove the link in Jira to drop this one.' }}
          </p>
        </Panel>

        <Panel v-if="actionError" position="bottom-right" class="graph-panel border-destructive/50 px-3 py-2 text-xs text-destructive">
          {{ actionError }}
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
    </Card>
  </div>
</template>

<style>
.dep-graph {
  --vf-node-bg: transparent;
  --vf-node-text: var(--card-foreground);
  --vf-connection-path: var(--primary);
  --vf-handle: var(--muted-foreground);
  background: var(--background);
}
.dep-graph .vue-flow__node-pr {
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: var(--radius-lg);
}
.dep-graph .vue-flow__background circle {
  fill: var(--border);
}
.dep-graph .vue-flow__connection-path {
  stroke: var(--primary);
  stroke-width: 2;
}
.dep-graph .graph-handle {
  width: 9px;
  height: 9px;
  background: var(--card);
  border: 1.5px solid var(--muted-foreground);
  opacity: 0;
  transition: opacity 120ms;
}
.dep-graph .vue-flow__node:hover .graph-handle,
.dep-graph .vue-flow__handle.connectingfrom,
.dep-graph .vue-flow__handle.connectingto,
.dep-graph.vue-flow__container .connecting .graph-handle {
  opacity: 1;
}
.dep-graph .vue-flow__handle.connectingto {
  border-color: var(--primary);
  background: var(--primary);
}
.dep-graph .vue-flow__edge-textbg {
  stroke-width: 1px;
}
.dep-graph .vue-flow__edge.selected .vue-flow__edge-path,
.dep-graph .vue-flow__edge:focus .vue-flow__edge-path {
  filter: drop-shadow(0 0 2px var(--ring));
}
.dep-graph .graph-panel {
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
}
.dep-graph .vue-flow__controls {
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  overflow: hidden;
  box-shadow: none;
}
.dep-graph .vue-flow__controls-button {
  background: var(--popover);
  border-bottom: 1px solid var(--border);
  color: var(--popover-foreground);
  fill: var(--popover-foreground);
}
.dep-graph .vue-flow__controls-button:last-child {
  border-bottom: 0;
}
.dep-graph .vue-flow__controls-button:hover {
  background: var(--accent);
}
.dep-graph .vue-flow__controls-button svg {
  fill: currentColor;
}
</style>
