<script setup lang="ts">
import { computed } from 'vue'
import { PhCaretDown, PhCaretRight, PhMagnifyingGlass, PhSortAscending, PhSortDescending } from '@phosphor-icons/vue'
import type { Bucket } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type SortDir } from '@/stores/layout'
import { BUCKETS } from '@/utils/format'
import PrRow from '@/components/PrRow.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const layout = useLayout()
const v = layout.view('prs', {
  query: '',
  scope: 'all' as 'all' | 'mine' | 'review' | 'team',
  bucket: '' as Bucket | '',
  repo: '',
  sort: 'urgency',
  dir: 'desc' as SortDir,
  group: 'bucket' as 'none' | 'bucket' | 'repo' | 'org',
  showDone: false,
})

const filtered = computed(() => {
  let prs = filterPrs(deck.prs, { query: v.query, repo: v.repo || undefined, buckets: v.bucket ? [v.bucket] : undefined })
  if (v.scope === 'mine') prs = prs.filter((p) => p.isMine)
  if (v.scope === 'review') prs = prs.filter((p) => p.action.kind === 'review' || p.relations.includes('reviewed'))
  if (v.scope === 'team') prs = prs.filter((p) => p.relations.includes('tracked'))
  if (!v.showDone) prs = prs.filter((p) => p.bucket !== 'done')
  return sortPrs(prs, v.sort, v.dir)
})

const groups = computed(() => {
  if (v.group === 'none') return [{ key: 'all', label: 'Pull requests', prs: filtered.value }]
  const keyOf = (p: (typeof filtered.value)[number]) => (v.group === 'bucket' ? p.bucket : v.group === 'org' ? p.owner : p.repo)
  const map = new Map<string, typeof filtered.value>()
  for (const p of filtered.value) map.set(keyOf(p), [...(map.get(keyOf(p)) ?? []), p])
  const order = v.group === 'bucket' ? [...BUCKETS.map((b) => b.key as string), 'done'] : [...map.keys()].sort()
  return order
    .filter((k) => map.has(k))
    .map((k) => ({ key: k, label: v.group === 'bucket' ? (BUCKETS.find((b) => b.key === k)?.label ?? 'Done') : k, prs: map.get(k)! }))
})
const collapsed = layout.view('prs-collapsed', {} as Record<string, boolean>)
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-72">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search title, branch, Jira key, author…" class="h-8 pl-8" />
      </div>
      <Tabs v-model="v.scope">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="mine">Mine</TabsTrigger>
          <TabsTrigger value="review">Reviews</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>
      </Tabs>
      <NativeSelect v-model="v.repo" size="sm">
        <NativeSelectOption value="">All repos</NativeSelectOption>
        <NativeSelectOption v-for="r in deck.repos" :key="r" :value="r">{{ r }}</NativeSelectOption>
      </NativeSelect>
      <span class="flex-1" />
      <Label class="gap-1.5 font-normal text-muted-foreground">
        Group
        <NativeSelect v-model="v.group" size="sm">
          <NativeSelectOption value="bucket">Status</NativeSelectOption>
          <NativeSelectOption value="repo">Repo</NativeSelectOption>
          <NativeSelectOption value="org">Org</NativeSelectOption>
          <NativeSelectOption value="none">None</NativeSelectOption>
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
      <Button variant="ghost" size="icon-sm" @click="v.dir = v.dir === 'desc' ? 'asc' : 'desc'">
        <PhSortDescending v-if="v.dir === 'desc'" /><PhSortAscending v-else />
      </Button>
      <Label class="gap-2 font-normal"><Switch v-model="v.showDone" /> Done</Label>
    </div>

    <Card v-for="g in groups" :key="g.key" class="gap-0 py-0">
      <button class="flex items-center gap-2 px-4 py-2.5 text-left" :class="{ 'border-b': !collapsed[g.key] }" @click="collapsed[g.key] = !collapsed[g.key]">
        <PhCaretRight v-if="collapsed[g.key]" :size="14" /><PhCaretDown v-else :size="14" />
        <span class="text-sm font-semibold">{{ g.label }}</span>
        <Badge variant="muted">{{ g.prs.length }}</Badge>
      </button>
      <div v-show="!collapsed[g.key]" class="p-1.5">
        <PrRow v-for="p in g.prs" :key="p.id" :pr="p" :compact="layout.prefs.dense" />
      </div>
    </Card>
    <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No pull requests match.</div>
  </div>
</template>
