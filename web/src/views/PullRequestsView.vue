<script setup lang="ts">
import { computed } from 'vue'
import { PhKanban, PhMagnifyingGlass, PhRows, PhX } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type SortDir } from '@/stores/layout'
import { BUCKETS } from '@/utils/format'
import { PR_FOCUS, type PrFocus } from '@/utils/prFocus'
import GroupCard from '@/components/GroupCard.vue'
import PrCard from '@/components/PrCard.vue'
import PrRow from '@/components/PrRow.vue'
import SortDirButton from '@/components/SortDirButton.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
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

const v = layout.view('prs', {
  query: '',
  scope: 'all' as Scope,
  /** Quick filter from a dashboard tile */
  focus: '' as PrFocus | '',
  repo: '',
  sort: 'urgency',
  dir: 'desc' as SortDir,
  group: 'bucket' as Grouping,
  showDone: false,
  display: 'list' as 'list' | 'board',
})

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
const groups = computed(() => {
  const group: Grouping = v.display === 'board' && v.group === 'none' ? 'bucket' : v.group
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
  <div :class="v.display === 'board' ? 'flex h-[calc(100svh-5.5rem)] flex-col gap-4 lg:h-[calc(100svh-6.5rem)]' : 'mx-auto max-w-6xl space-y-4'">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-72">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search title, branch, Jira key, author…" class="h-8 pl-8" />
      </div>
      <Tabs v-model="v.scope">
        <TabsList>
          <TabsTrigger v-for="s in SCOPES" :key="s.value" :value="s.value" :count="scopeCount(s)">{{ s.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <NativeSelect v-model="v.repo" size="sm">
        <NativeSelectOption value="">All repos</NativeSelectOption>
        <NativeSelectOption v-for="r in deck.repos" :key="r" :value="r">{{ r }}</NativeSelectOption>
      </NativeSelect>
      <Badge v-if="v.focus" variant="primary" class="h-7 gap-1 pr-1 text-xs">
        {{ PR_FOCUS[v.focus].label }}
        <button type="button" class="rounded p-0.5 hover:bg-primary/15" aria-label="Clear filter" @click="v.focus = ''"><PhX /></button>
      </Badge>
      <span class="flex-1" />
      <ToggleGroup :model-value="v.display" type="single" @update:model-value="(d) => d && (v.display = d as typeof v.display)" variant="outline" size="sm" aria-label="Display">
        <ToggleGroupItem value="list" aria-label="List"><PhRows /></ToggleGroupItem>
        <ToggleGroupItem value="board" aria-label="Board"><PhKanban /></ToggleGroupItem>
      </ToggleGroup>
      <Label class="gap-1.5 font-normal text-muted-foreground">
        {{ v.display === 'board' ? 'Columns' : 'Group' }}
        <NativeSelect v-model="v.group" size="sm">
          <NativeSelectOption value="bucket">Status</NativeSelectOption>
          <NativeSelectOption value="repo">Repo</NativeSelectOption>
          <NativeSelectOption value="org">Org</NativeSelectOption>
          <NativeSelectOption v-if="v.display === 'list'" value="none">None</NativeSelectOption>
        </NativeSelect>
      </Label>
      <Label class="gap-1.5 font-normal text-muted-foreground">
        Sort
        <NativeSelect v-model="v.sort" size="sm">
          <NativeSelectOption value="urgency">Urgency</NativeSelectOption>
          <NativeSelectOption value="updated">Updated</NativeSelectOption>
          <NativeSelectOption value="created">Created</NativeSelectOption>
          <NativeSelectOption value="repo">Repo</NativeSelectOption>
          <NativeSelectOption value="size">Size</NativeSelectOption>
        </NativeSelect>
      </Label>
      <SortDirButton v-model="v.dir" />
      <Label class="gap-2 font-normal"><Switch v-model="v.showDone" /> Done</Label>
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
          <span class="truncate text-sm font-semibold" :title="g.label">{{ g.label }}</span>
          <Badge variant="muted">{{ g.prs.length }}</Badge>
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
        <PrRow v-for="p in g.prs" :key="p.id" :pr="p" :compact="layout.prefs.dense" />
      </GroupCard>
      <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No pull requests match.</div>
    </template>
  </div>
</template>
