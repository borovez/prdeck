<script setup lang="ts">
import { computed } from 'vue'
import { PhFunnel, PhMagnifyingGlass, PhSlackLogo } from '@phosphor-icons/vue'
import type { SlackItem, SlackKind, SlackStatus } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout, type SortDir } from '@/stores/layout'
import SlackList from '@/components/SlackList.vue'
import FilterChips from '@/components/FilterChips.vue'
import ViewMenu, { type ViewSection } from '@/components/ViewMenu.vue'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
/** View options in the View menu, and their defaults (Reset view) */
const VIEW_DEFAULTS = { kind: '' as SlackKind | '', dir: 'desc' as SortDir }
const v = useLayout().view('slack', { status: 'new' as SlackStatus, query: '', ...VIEW_DEFAULTS })
const all = computed(() => deck.overview?.slack ?? [])
const matchesQuery = (i: SlackItem) => {
  const q = v.query.toLowerCase().trim()
  return !q || `${i.text} ${i.userName} ${i.channelName} ${i.jiraKey ?? ''}`.toLowerCase().includes(q)
}
const items = computed(() => {
  const list = all.value.filter((i) => i.status === v.status && (!v.kind || i.kind === v.kind) && matchesQuery(i))
  return v.dir === 'desc' ? list : [...list].reverse()
})
const STATUS_TABS: { value: SlackStatus; label: string }[] = [
  { value: 'new', label: 'Inbox' },
  { value: 'done', label: 'Done' },
  { value: 'dismissed', label: 'Dismissed' },
]
const count = (s: SlackStatus) => all.value.filter((i) => i.status === s).length
const KINDS: { value: SlackKind; label: string }[] = [
  { value: 'mention', label: '@-mentions' },
  { value: 'dm', label: 'Direct messages' },
  { value: 'group', label: 'Group DMs' },
  { value: 'saved', label: 'Saved / bookmarked' },
  { value: 'todo', label: 'Marked todo' },
]
const kindCount = (k: SlackKind) => all.value.filter((i) => i.status === v.status && i.kind === k).length
const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'kind', label: 'Source', icon: PhFunnel, allLabel: 'All sources', options: KINDS.map((k) => ({ value: k.value, label: `${k.label} · ${kindCount(k.value)}` })) },
  { type: 'dir', key: 'dir', desc: 'Newest first', asc: 'Oldest first' },
])
/** Active filters that aren't otherwise visible in the toolbar */
const chips = computed(() =>
  v.kind ? [{ key: 'kind', label: KINDS.find((k) => k.value === v.kind)?.label ?? v.kind, clear: () => (v.kind = '') }] : [],
)
</script>

<template>
  <!-- Width cap on the children, not the page, so the scrollbar sits at the far right -->
  <div class="flex flex-col gap-4 *:max-w-5xl">
    <Alert v-if="!deck.overview?.configured.slack">
      <PhSlackLogo />
      <AlertTitle>Slack isn't connected yet</AlertTitle>
      <AlertDescription>Add a user token in Settings to pull mentions, unanswered DMs and saved items.</AlertDescription>
      <AlertAction>
        <Button size="sm" as-child><RouterLink to="/settings">Connect Slack</RouterLink></Button>
      </AlertAction>
    </Alert>
    <div class="flex flex-wrap items-center gap-2">
      <Tabs v-model="v.status">
        <TabsList>
          <TabsTrigger v-for="t in STATUS_TABS" :key="t.value" :value="t.value" :count="count(t.value)">{{ t.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="relative w-64 min-w-40 flex-1 sm:flex-none">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search messages, people, channels…" class="h-8 pl-8" />
      </div>
      <FilterChips :chips="chips" />
      <span class="flex-1" />
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
    </div>
    <!-- The page scrolls (native scrollbar at the window edge, like Settings) -->
    <div>
        <!-- overflow-visible: Card clips by default, which would make it the sticky container for the headings -->
        <Card class="gap-0 overflow-visible py-0">
          <SlackList :items="items" sticky class="[&>section:first-child>h3]:rounded-t-xl [&>section:last-child_[data-slack-id]:last-child]:rounded-b-xl" />
          <div v-if="!items.length" class="py-12 text-center text-muted-foreground">Nothing here.</div>
        </Card>
    </div>
  </div>
</template>
