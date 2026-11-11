<script setup lang="ts">
import { computed } from 'vue'
import { PhGitBranch, PhKanban, PhMagnifyingGlass, PhRows } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type SortDir } from '@/stores/layout'
import { BUCKETS } from '@/utils/format'
import { PR_FOCUS, type PrFocus } from '@/utils/prFocus'
import FilterChips from '@/components/FilterChips.vue'
import GroupCard from '@/components/GroupCard.vue'
import ViewMenu, { type ViewSection } from '@/components/ViewMenu.vue'
import PrCard from '@/components/PrCard.vue'
import PrRow from '@/components/PrRow.vue'
import RepoName from '@/components/RepoName.vue'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ScrollArea } from '@/components/ui/scroll-area'

const deck = useDeck()
const layout = useLayout()
type Scope = 'all' | 'mine' | 'review' | 'team'
type Grouping = 'none' | 'bucket' | 'repo' | 'org'
const SCOPES: { value: Scope; label: string; match: (p: PrView) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'mine', label: 'Mine', match: (p) => p.isMine },
  { value: 'review', label: 'Reviews', match: (p) => p.action.kind === 'review' || p.relations.includes('reviewed') },
  { value: 'team', label: 'Team', match: (p) => p.relations.includes('tracked') },
]

/** View options in the View menu, and their defaults (Reset view) */
const VIEW_DEFAULTS = { repo: '', sort: 'urgency', dir: 'desc' as SortDir, group: 'bucket' as Grouping, showDone: false }
const v = layout.view('prs', {
  query: '',
  scope: 'all' as Scope,
  /** Quick filter from a dashboard tile */
  focus: '' as PrFocus | '',
  display: 'list' as 'list' | 'board',
  ...VIEW_DEFAULTS,
})
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: 'bucket', label: 'Status' },
  { value: 'repo', label: 'Repo' },
  { value: 'org', label: 'Org' },
  { value: 'none', label: 'None' },
]
const SORTS = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'repo', label: 'Repo' },
  { value: 'size', label: 'Size' },
]
const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'repo', label: 'Repo', icon: PhGitBranch, allLabel: 'All repos', options: deck.repos.map((r) => ({ value: r, label: r })), mono: true },
  { type: 'radio', key: 'group', label: v.display === 'board' ? 'Columns' : 'Group by', options: GROUPINGS.filter((g) => v.display === 'list' || g.value !== 'none') },
  { type: 'radio', key: 'sort', label: 'Sort by', options: SORTS },
  { type: 'dir', key: 'dir' },
  { type: 'check', key: 'showDone', label: 'Show done' },
])
/** Active filters that aren't otherwise visible in the toolbar */
const chips = computed(() => [
  ...(v.focus ? [{ key: 'focus', label: PR_FOCUS[v.focus].label, clear: () => (v.focus = '') }] : []),
  ...(v.repo ? [{ key: 'repo', label: v.repo, clear: () => (v.repo = '') }] : []),
])

/** Every filter except the scope tab, so each tab can show its count */
const base = computed(() =>
  filterPrs(deck.prs, { query: v.query, repo: v.repo || undefined }).filter(
    (p) => (v.showDone || p.bucket !== 'done') && (!v.focus || PR_FOCUS[v.focus].match(p)),
  ),
)
const scopeCount = (s: (typeof SCOPES)[number]) => base.value.filter(s.match).length
const filtered = computed(() => {
  const scope = SCOPES.find((s) => s.value === v.scope) ?? SCOPES[0]
  return sortPrs(base.value.filter(scope.match), v.sort, v.dir)
})

/** List sections or board columns. A board always has columns, so "None" falls back to status there. */
/** A board always has columns, so "None" falls back to status there */
const groupBy = computed<Grouping>(() => (v.display === 'board' && v.group === 'none' ? 'bucket' : v.group))
const groups = computed(() => {
  const group = groupBy.value
  if (group === 'none') return [{ key: 'all', label: 'Pull requests', prs: filtered.value }]
  const keyOf = (p: PrView) => (group === 'bucket' ? p.bucket : group === 'org' ? p.owner : p.repo)
  const map = new Map<string, PrView[]>()
  for (const p of filtered.value) map.set(keyOf(p), [...(map.get(keyOf(p)) ?? []), p])
  // Status columns keep their order and show even when empty on the board
  const order = group === 'bucket' ? [...BUCKETS.map((b) => b.key as string), ...(v.showDone ? ['done'] : [])] : [...map.keys()].sort()
  return order
    .filter((k) => map.has(k) || (v.display === 'board' && group === 'bucket'))
    .map((k) => ({ key: k, label: group === 'bucket' ? (BUCKETS.find((b) => b.key === k)?.label ?? 'Done') : k, prs: map.get(k) ?? [] }))
})
const collapsed = layout.view('prs-collapsed', {} as Record<string, boolean>)
</script>

<template>
  <div :class="v.display === 'board' ? 'h-page flex flex-col gap-4' : 'max-w-6xl space-y-4'">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-64 min-w-40 flex-1 sm:flex-none">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search title, branch, Jira key, author…" class="h-8 pl-8" />
      </div>
      <Tabs v-model="v.scope">
        <TabsList>
          <TabsTrigger v-for="s in SCOPES" :key="s.value" :value="s.value" :count="scopeCount(s)">{{ s.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <FilterChips :chips="chips" />
      <span class="flex-1" />
      <ToggleGroup :model-value="v.display" type="single" variant="outline" size="sm" aria-label="Display" @update:model-value="(d) => d && (v.display = d as typeof v.display)">
        <ToggleGroupItem value="list" aria-label="List"><PhRows /></ToggleGroupItem>
        <ToggleGroupItem value="board" aria-label="Board"><PhKanban /></ToggleGroupItem>
      </ToggleGroup>
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
    </div>

    <!-- Horizontal scroll across columns; the viewport's content gets full height so each column can scroll on its own -->
    <ScrollArea
      v-if="v.display === 'board'"
      type="auto"
      orientation="horizontal"
      class="-mx-4 min-h-0 flex-1 lg:-mx-6 [&>[data-slot=scroll-area-viewport]>div]:h-full"
    >
      <div class="flex h-full gap-3 px-4 pb-4 lg:px-6">
      <section v-for="g in groups" :key="g.key" class="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/50">
        <header class="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
          <RepoName v-if="groupBy === 'repo'" :repo="g.label" class="text-sm font-semibold" />
          <span v-else class="truncate text-sm font-semibold" :title="g.label">{{ g.label }}</span>
          <Badge variant="count">{{ g.prs.length }}</Badge>
        </header>
        <ScrollArea type="auto" class="min-h-0 flex-1">
          <!-- pt-1: the viewport clips, and the selected card's ring draws outside the card; pr-3.5 clears the scrollbar (shown only when the column overflows) -->
          <div class="space-y-2 pt-1 pr-3.5 pb-2 pl-2">
            <PrCard v-for="p in g.prs" :id="p.id" :key="p.id" :pr="p" class="cursor-pointer" @click="deck.selectedId = p.id" />
            <p v-if="!g.prs.length" class="py-6 text-center text-xs text-muted-foreground">Nothing here</p>
          </div>
        </ScrollArea>
      </section>
      </div>
    </ScrollArea>
    <template v-else>
      <GroupCard v-for="g in groups" :key="g.key" v-model:collapsed="collapsed[g.key]" :label="g.label" :count="g.prs.length">
        <template v-if="groupBy === 'repo'" #label><RepoName :repo="g.label" /></template>
        <PrRow v-for="p in g.prs" :key="p.id" :pr="p" :compact="layout.prefs.dense" />
      </GroupCard>
      <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No pull requests match.</div>
    </template>
  </div>
</template>
