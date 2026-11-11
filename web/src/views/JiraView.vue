<script setup lang="ts">
import { computed } from 'vue'
import { PhKanban, PhMagnifyingGlass } from '@phosphor-icons/vue'
import type { JiraIssueView, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout, type SortDir } from '@/stores/layout'
import GroupCard from '@/components/GroupCard.vue'
import JiraRow from '@/components/JiraRow.vue'
import SortDirButton from '@/components/SortDirButton.vue'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const layout = useLayout()

/** One row per Jira key: from my JQL results and from keys found in PR titles, branches and descriptions. */
interface Item {
  key: string
  project: string
  issue: JiraIssueView | null
  prs: PrView[]
  mine: boolean
  done: boolean
  updated: string
}

type Scope = 'all' | 'mine' | 'linked' | 'unlinked'
const SCOPES: { value: Scope; label: string; match: (i: Item) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'mine', label: 'Mine', match: (i) => i.mine },
  { value: 'linked', label: 'With PRs', match: (i) => i.prs.length > 0 },
  { value: 'unlinked', label: 'No PRs', match: (i) => i.prs.length === 0 },
]
const CATEGORIES = [
  { value: 'new', label: 'To do' },
  { value: 'indeterminate', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const v = layout.view('jira', {
  query: '',
  scope: 'mine' as Scope,
  project: '',
  category: '',
  showDone: false,
  group: 'status' as 'none' | 'status' | 'project' | 'parent',
  sort: 'updated' as 'updated' | 'key',
  dir: 'desc' as SortDir,
})
const collapsed = layout.view('jira-collapsed', {} as Record<string, boolean>)

const items = computed<Item[]>(() => {
  const keys = new Map<string, PrView[]>()
  for (const p of deck.prs) for (const k of p.jiraKeys) keys.set(k, [...(keys.get(k) ?? []), p])
  for (const j of deck.overview?.jira ?? []) if (!keys.has(j.key)) keys.set(j.key, [])
  return [...keys].map(([key, prs]) => {
    const issue = deck.jiraByKey.get(key) ?? null
    const updated = [issue?.updated ?? '', ...prs.map((p) => p.updatedAt)].sort().at(-1)!
    return {
      key,
      project: key.split('-')[0],
      issue,
      prs,
      mine: !!issue?.isMine || prs.some((p) => p.isMine),
      done: issue ? issue.statusCategory === 'done' : prs.every((p) => p.state !== 'OPEN'),
      updated,
    }
  })
})
const projects = computed(() => [...new Set(items.value.map((i) => i.project))].sort())

/** Every filter except the scope tab, so each tab can show its count */
const base = computed(() => {
  const q = v.query.toLowerCase().trim()
  return items.value.filter(
    (i) =>
      (v.showDone || !i.done) &&
      (!v.project || i.project === v.project) &&
      (!v.category || i.issue?.statusCategory === v.category) &&
      (!q ||
        [i.key, i.issue?.summary, i.issue?.assignee?.displayName, i.issue?.status, ...i.prs.map((p) => `${p.id} ${p.title}`)]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )
})
const scopeCount = (s: (typeof SCOPES)[number]) => base.value.filter(s.match).length

const filtered = computed(() => {
  const scope = SCOPES.find((s) => s.value === v.scope) ?? SCOPES[0]
  const sign = v.dir === 'asc' ? 1 : -1
  const cmp = (a: Item, b: Item) =>
    v.sort === 'key' ? a.key.localeCompare(b.key, undefined, { numeric: true }) : a.updated.localeCompare(b.updated)
  return base.value.filter(scope.match).sort((a, b) => cmp(a, b) * sign)
})

const CATEGORY_ORDER = ['indeterminate', 'new', 'done']
const groups = computed(() => {
  if (v.group === 'none') return [{ key: 'all', label: 'Jira issues', items: filtered.value }]
  const map = new Map<string, { label: string; rank: string; items: Item[] }>()
  for (const i of filtered.value) {
    const [key, label, rank] =
      v.group === 'project'
        ? [i.project, i.project, i.project]
        : v.group === 'parent'
          ? i.issue?.parent
            ? [i.issue.parent.key, `${i.issue.parent.key} · ${i.issue.parent.summary}`, `0${i.issue.parent.key}`]
            : ['~none', 'No parent', '1']
          : i.issue
            ? [i.issue.status, i.issue.status, `${CATEGORY_ORDER.indexOf(i.issue.statusCategory)}${i.issue.status}`]
            : ['~unknown', 'Not loaded from Jira', '9']
    const g = map.get(key) ?? { label, rank, items: [] }
    g.items.push(i)
    map.set(key, g)
  }
  return [...map].sort(([, a], [, b]) => a.rank.localeCompare(b.rank, undefined, { numeric: true })).map(([key, g]) => ({ key, ...g }))
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4">
    <Alert v-if="deck.overview && !deck.overview.configured.jira">
      <PhKanban />
      <AlertTitle>Jira isn't connected yet</AlertTitle>
      <AlertDescription>Keys found in your PRs are listed below. Connect Jira for status, assignee, your own tasks and transitions.</AlertDescription>
      <AlertAction>
        <Button size="sm" as-child><RouterLink to="/settings">Connect Jira</RouterLink></Button>
      </AlertAction>
    </Alert>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-72">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search key, summary, assignee, PR…" class="h-8 pl-8" />
      </div>
      <Tabs v-model="v.scope">
        <TabsList>
          <TabsTrigger v-for="s in SCOPES" :key="s.value" :value="s.value" :count="scopeCount(s)">{{ s.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <NativeSelect v-model="v.project" size="sm">
        <NativeSelectOption value="">All projects</NativeSelectOption>
        <NativeSelectOption v-for="p in projects" :key="p" :value="p">{{ p }}</NativeSelectOption>
      </NativeSelect>
      <NativeSelect v-if="deck.overview?.configured.jira" v-model="v.category" size="sm">
        <NativeSelectOption value="">Any status</NativeSelectOption>
        <NativeSelectOption v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</NativeSelectOption>
      </NativeSelect>
      <span class="flex-1" />
      <Label class="gap-1.5 font-normal text-muted-foreground">
        Group
        <NativeSelect v-model="v.group" size="sm">
          <NativeSelectOption value="status">Status</NativeSelectOption>
          <NativeSelectOption value="project">Project</NativeSelectOption>
          <NativeSelectOption value="parent">Parent / epic</NativeSelectOption>
          <NativeSelectOption value="none">None</NativeSelectOption>
        </NativeSelect>
      </Label>
      <Label class="gap-1.5 font-normal text-muted-foreground">
        Sort
        <NativeSelect v-model="v.sort" size="sm">
          <NativeSelectOption value="updated">Updated</NativeSelectOption>
          <NativeSelectOption value="key">Key</NativeSelectOption>
        </NativeSelect>
      </Label>
      <SortDirButton v-model="v.dir" />
      <Label class="gap-2 font-normal"><Switch v-model="v.showDone" /> Done</Label>
    </div>

    <GroupCard v-for="g in groups" :key="g.key" v-model:collapsed="collapsed[g.key]" :label="g.label" :count="g.items.length">
      <div class="-m-1.5 divide-y">
        <JiraRow v-for="i in g.items" :key="i.key" :issue-key="i.key" :issue="i.issue" :prs="i.prs" :dense="layout.prefs.dense" />
      </div>
    </GroupCard>
    <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No Jira issues match.</div>
  </div>
</template>
