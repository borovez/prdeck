<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PhBuildings,
  PhCheckCircle,
  PhCircleDashed,
  PhEye,
  PhFlag,
  PhGitBranch,
  PhGitPullRequest,
  PhKanban,
  PhLightning,
  PhLinkSimple,
  PhMagnifyingGlass,
  PhRocketLaunch,
  PhRows,
  PhSquaresFour,
  PhTag,
  PhUser,
} from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type SortDir } from '@/stores/layout'
import { BUCKETS } from '@/utils/format'
import { PR_FOCUS, type PrFocus } from '@/utils/prFocus'
import ActiveFilters from '@/components/ActiveFilters.vue'
import CollapseAllButton from '@/components/CollapseAllButton.vue'
import DisplayMenu, { type DisplayRow } from '@/components/DisplayMenu.vue'
import FilterChips from '@/components/FilterChips.vue'
import FilterMenu, { type FilterField, type FilterOption, type Filters } from '@/components/FilterMenu.vue'
import GroupCard from '@/components/GroupCard.vue'
import PrCard from '@/components/PrCard.vue'
import PrHover from '@/components/PrHover.vue'
import PrRow from '@/components/PrRow.vue'
import RepoName from '@/components/RepoName.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

const deck = useDeck()
const layout = useLayout()
const filterMenu = ref<InstanceType<typeof FilterMenu> | null>(null)
type Scope = 'all' | 'mine' | 'review' | 'team'
type Grouping = 'none' | 'bucket' | 'repo' | 'org' | 'author' | 'action'
const SCOPES: { value: Scope; label: string; match: (p: PrView) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'mine', label: 'Mine', match: (p) => p.isMine },
  { value: 'review', label: 'Reviews', match: (p) => p.action.kind === 'review' || p.relations.includes('reviewed') },
  { value: 'team', label: 'Team', match: (p) => p.relations.includes('tracked') },
]

/** Display options, and their defaults (Reset view) */
const VIEW_DEFAULTS = {
  display: 'list' as 'list' | 'board',
  sort: 'urgency',
  dir: 'desc' as SortDir,
  group: 'bucket' as Grouping,
  showDone: false,
  showEmpty: false,
  hidden: [] as string[],
}
const v = layout.view('prs', {
  query: '',
  scope: 'all' as Scope,
  /** Quick filter from a dashboard tile */
  focus: '' as PrFocus | '',
  filters: {} as Filters,
  /** Older single-repo filter, moved into `filters` */
  repo: '',
  ...VIEW_DEFAULTS,
})
if (v.repo) {
  v.filters = { ...v.filters, repo: [v.repo] }
  v.repo = ''
}

const GROUPINGS = [
  { value: 'bucket', label: 'Status' },
  { value: 'action', label: 'Next action' },
  { value: 'repo', label: 'Repo' },
  { value: 'org', label: 'Org' },
  { value: 'author', label: 'Author' },
  { value: 'none', label: 'No grouping' },
]
const SORTS = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'repo', label: 'Repo' },
  { value: 'size', label: 'Size' },
]
/** Parts of a row that Display can hide (PrRow `hide`) */
const PROPERTIES = [
  { value: 'avatar', label: 'Avatar' },
  { value: 'repo', label: 'Repo' },
  { value: 'author', label: 'Author' },
  { value: 'updated', label: 'Updated' },
  { value: 'jira', label: 'Jira' },
  { value: 'detail', label: 'Next step' },
  { value: 'deps', label: 'Dependencies' },
  { value: 'threads', label: 'Conversations' },
  { value: 'flags', label: 'Feature flags' },
  { value: 'checks', label: 'Checks' },
  { value: 'release', label: 'Released' },
  { value: 'contents', label: 'Release contents' },
  { value: 'action', label: 'Action' },
]
const displayRows = computed<DisplayRow[]>(() => [
  { type: 'select', key: 'group', label: v.display === 'board' ? 'Columns' : 'Grouping', options: GROUPINGS.filter((g) => v.display === 'list' || g.value !== 'none') },
  { type: 'order', key: 'sort', dirKey: 'dir', label: 'Ordering', options: SORTS },
  { type: 'heading' },
  { type: 'switch', key: 'showDone', label: 'Show merged and closed' },
  { type: 'switch', key: 'showEmpty', label: 'Show empty groups' },
  ...(v.display === 'list'
    ? ([{ type: 'heading', label: 'List options' }, { type: 'properties', key: 'hidden', label: 'Display properties', options: PROPERTIES }] as DisplayRow[])
    : []),
])

// ---------- Filters ----------

const STATUS_LABEL: Record<string, string> = { ...Object.fromEntries(BUCKETS.map((b) => [b.key, b.label])), done: 'Done' }
const CHECKS: Record<string, string> = { SUCCESS: 'Passing', FAILURE: 'Failing', ERROR: 'Failing', PENDING: 'Running', EXPECTED: 'Running', NONE: 'No checks' }
const REVIEW: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required', none: 'No review needed' }

/** Each filter field: the values a PR has for it (a PR matches when any selected value is among them) */
interface FieldDef extends Omit<FilterField, 'options'> {
  values: (p: PrView) => string[]
  optionLabel?: (value: string) => string
  hint?: (value: string) => string
  /** Fixed option order; otherwise by count */
  order?: string[]
  iconOf?: (value: string) => Pick<FilterOption, 'icon' | 'iconClass' | 'avatar'>
}
const FIELDS: FieldDef[] = [
  { key: 'status', label: 'Status', icon: PhCircleDashed, group: 0, values: (p) => [p.bucket], optionLabel: (x) => STATUS_LABEL[x] ?? x, order: [...BUCKETS.map((b) => b.key), 'done'] },
  { key: 'action', label: 'Next action', icon: PhLightning, group: 0, values: (p) => [p.action.label] },
  {
    key: 'state',
    label: 'State',
    icon: PhGitPullRequest,
    group: 0,
    values: (p) => [p.state === 'OPEN' ? (p.isDraft ? 'Draft' : 'Open') : p.state === 'MERGED' ? 'Merged' : 'Closed'],
    order: ['Open', 'Draft', 'Merged', 'Closed'],
  },
  {
    key: 'checks',
    label: 'Checks',
    icon: PhCheckCircle,
    group: 0,
    values: (p) => (p.state === 'OPEN' ? [CHECKS[p.checks.state]] : []),
    order: ['Failing', 'Running', 'Passing', 'No checks'],
    iconOf: (x) => ({ icon: PhCheckCircle, iconClass: x === 'Failing' ? 'text-destructive' : x === 'Passing' ? 'text-success' : x === 'Running' ? 'text-warning' : undefined }),
  },
  { key: 'review', label: 'Review', icon: PhEye, group: 0, values: (p) => (p.state === 'OPEN' ? [REVIEW[p.reviewDecision ?? 'none']] : []), order: Object.values(REVIEW) },
  { key: 'repo', label: 'Repo', icon: PhGitBranch, group: 1, values: (p) => [p.repo], optionLabel: (x) => x.split('/')[1] ?? x, hint: (x) => x.split('/')[0] },
  { key: 'org', label: 'Org', icon: PhBuildings, group: 1, values: (p) => [p.owner] },
  {
    key: 'author',
    label: 'Author',
    icon: PhUser,
    group: 1,
    values: (p) => [p.author.login],
    iconOf: (x) => ({ avatar: deck.prs.find((p) => p.author.login === x)?.author.avatarUrl ?? undefined }),
  },
  { key: 'label', label: 'Label', icon: PhTag, group: 1, values: (p) => p.labels.map((l) => l.name) },
  { key: 'jira', label: 'Jira project', icon: PhKanban, group: 2, values: (p) => (p.jiraKeys.length ? [...new Set(p.jiraKeys.map((k) => k.split('-')[0]))] : ['No Jira issue']) },
  {
    key: 'deps',
    label: 'Dependencies',
    icon: PhLinkSimple,
    group: 2,
    values: (p) => [
      ...(p.dependsOn.some((d) => !d.satisfied) ? ['Blocked'] : []),
      ...(p.dependsOn.length ? ['Has prerequisites'] : []),
      ...(p.dependents.length ? ['Blocks others'] : []),
      ...(!p.dependsOn.length && !p.dependents.length ? ['No dependencies'] : []),
    ],
    order: ['Blocked', 'Has prerequisites', 'Blocks others', 'No dependencies'],
  },
  {
    key: 'release',
    label: 'Release',
    icon: PhRocketLaunch,
    group: 2,
    values: (p) => [
      ...(p.flow === 'release' ? ['Release PR'] : p.flow === 'hotfix' ? ['Hotfix'] : p.flow === 'backmerge' ? ['Backmerge'] : []),
      ...(p.state === 'MERGED' ? [p.release?.released || p.releasedIn ? 'Released' : 'Not released yet'] : []),
      ...(p.shipsIn.length ? ['In a release'] : []),
    ],
    order: ['Release PR', 'Hotfix', 'Backmerge', 'In a release', 'Not released yet', 'Released'],
  },
  { key: 'flag', label: 'Feature flag', icon: PhFlag, group: 2, mono: true, values: (p) => (p.flags.length ? p.flags : ['No feature flag']) },
]

const matchesField = (p: PrView, f: FieldDef, filters: Filters) => {
  const sel = filters[f.key]
  return !sel?.length || f.values(p).some((x) => sel.includes(x))
}
/** Search, quick filter and "show done": applied before the filter menu */
const pre = computed(() =>
  filterPrs(deck.prs, { query: v.query }).filter((p) => (v.showDone || p.bucket !== 'done') && (!v.focus || PR_FOCUS[v.focus].match(p))),
)
/** Menu options with counts: what each value would match given the other filters (and the scope tab) */
const fields = computed<FilterField[]>(() => {
  const scope = SCOPES.find((s) => s.value === v.scope) ?? SCOPES[0]
  const inScope = pre.value.filter(scope.match)
  return FIELDS.map((f) => {
    const others = inScope.filter((p) => FIELDS.every((g) => g === f || matchesField(p, g, v.filters)))
    const counts = new Map<string, number>()
    for (const p of others) for (const x of new Set(f.values(p))) counts.set(x, (counts.get(x) ?? 0) + 1)
    // Keep selected values listed even when nothing matches them now
    for (const x of v.filters[f.key] ?? []) if (!counts.has(x)) counts.set(x, 0)
    const keys = [...counts.keys()].sort((a, b) =>
      f.order ? (f.order.indexOf(a) + 1 || 99) - (f.order.indexOf(b) + 1 || 99) : counts.get(b)! - counts.get(a)! || a.localeCompare(b),
    )
    return {
      key: f.key,
      label: f.label,
      icon: f.icon,
      group: f.group,
      mono: f.mono,
      options: keys.map((x) => ({ value: x, label: f.optionLabel?.(x) ?? x, hint: f.hint?.(x), count: counts.get(x), ...f.iconOf?.(x) })),
    }
  })
})
/** Active filters that aren't in the filter menu */
const chips = computed(() => (v.focus ? [{ key: 'focus', label: PR_FOCUS[v.focus].label, clear: () => (v.focus = '') }] : []))

/** Every filter except the scope tab, so each tab can show its count */
const base = computed(() => pre.value.filter((p) => FIELDS.every((f) => matchesField(p, f, v.filters))))
const scopeCount = (s: (typeof SCOPES)[number]) => base.value.filter(s.match).length
const filtered = computed(() => {
  const scope = SCOPES.find((s) => s.value === v.scope) ?? SCOPES[0]
  return sortPrs(base.value.filter(scope.match), v.sort, v.dir)
})

/** A board always has columns, so "None" falls back to status there */
const groupBy = computed<Grouping>(() => (v.display === 'board' && v.group === 'none' ? 'bucket' : v.group))
const groups = computed(() => {
  const group = groupBy.value
  if (group === 'none') return [{ key: 'all', label: 'Pull requests', prs: filtered.value }]
  const keyOf = (p: PrView) =>
    group === 'bucket' ? p.bucket : group === 'org' ? p.owner : group === 'author' ? p.author.login : group === 'action' ? p.action.label : p.repo
  const map = new Map<string, PrView[]>()
  for (const p of filtered.value) map.set(keyOf(p), [...(map.get(keyOf(p)) ?? []), p])
  // Status columns keep their order and show even when empty on the board
  const order = group === 'bucket' ? [...BUCKETS.map((b) => b.key as string), ...(v.showDone ? ['done'] : [])] : [...map.keys()].sort()
  return order
    .filter((k) => map.has(k) || ((v.display === 'board' || v.showEmpty) && group === 'bucket'))
    .map((k) => ({ key: k, label: group === 'bucket' ? (BUCKETS.find((b) => b.key === k)?.label ?? 'Done') : k, prs: map.get(k) ?? [] }))
})
const collapsed = layout.view('prs-collapsed', {} as Record<string, boolean>)
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every((g) => collapsed[g.key]))
const toggleAll = () => {
  const to = !allCollapsed.value
  for (const g of groups.value) collapsed[g.key] = to
}
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
      <span class="flex-1" />
      <FilterMenu ref="filterMenu" v-model="v.filters" :fields="fields" />
      <CollapseAllButton v-if="v.display === 'list' && groups.length > 1" :collapsed="allCollapsed" @toggle="toggleAll" />
      <DisplayMenu
        :state="v"
        :rows="displayRows"
        :defaults="VIEW_DEFAULTS"
        layout-key="display"
        :layouts="[
          { value: 'list', label: 'List', icon: PhRows },
          { value: 'board', label: 'Board', icon: PhSquaresFour },
        ]"
      />
    </div>
    <!-- Active filters, under the toolbar so it never wraps -->
    <div v-if="chips.length || Object.keys(v.filters).length" class="-mt-2 flex flex-wrap items-center gap-1.5">
      <FilterChips :chips="chips" />
      <ActiveFilters v-model="v.filters" :fields="fields" @open="(k) => filterMenu?.openOn(k)" />
      <Button v-if="Object.keys(v.filters).length > 1" variant="ghost" size="sm" class="h-7 text-xs text-muted-foreground" @click="v.filters = {}">Clear all</Button>
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
            <PrHover v-for="p in g.prs" :key="p.id" :pr="p">
              <PrCard :id="p.id" :pr="p" class="cursor-pointer" @click="deck.selectedId = p.id" />
            </PrHover>
            <p v-if="!g.prs.length" class="py-6 text-center text-xs text-muted-foreground">Nothing here</p>
          </div>
        </ScrollArea>
      </section>
      </div>
    </ScrollArea>
    <template v-else>
      <GroupCard v-for="g in groups" :key="g.key" v-model:collapsed="collapsed[g.key]" :label="g.label" :count="g.prs.length">
        <template v-if="groupBy === 'repo'" #label><RepoName :repo="g.label" /></template>
        <PrRow v-for="p in g.prs" :key="p.id" :pr="p" :compact="layout.prefs.dense" :hide="v.hidden" />
      </GroupCard>
      <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No pull requests match.</div>
    </template>
  </div>
</template>
