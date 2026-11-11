<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowsClockwise, PhCheckCircle, PhGitBranch, PhMagnifyingGlass, PhWarning } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { timeAgo } from '@/utils/format'
import { isUnreleased } from '@/utils/releaseFlow'
import CollapseAllButton from '@/components/CollapseAllButton.vue'
import GroupCard from '@/components/GroupCard.vue'
import PrRow from '@/components/PrRow.vue'
import RepoName from '@/components/RepoName.vue'
import ReleaseItems from '@/components/ReleaseItems.vue'
import ReleaseGraph from '@/components/ReleaseGraph.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Releases: what each release PR ships (dev → master, release/* → master), and merged work not in a release yet.
 * Hotfixes: PRs straight to the release branch, and whether they made it back into dev.
 */
const deck = useDeck()
const v = useLayout().view('releases', { tab: 'releases' as 'releases' | 'hotfixes' | 'graph', query: '', collapsed: {} as Record<string, boolean> })

const matches = (p: PrView) => {
  const q = v.query.trim().toLowerCase()
  if (!q) return true
  const c = deck.releaseById.get(p.id)
  const hay = `${p.id} ${p.title} ${p.headRef} ${p.baseRef} ${p.jiraKeys.join(' ')} ${c?.jiraKeys.join(' ') ?? ''} ${c?.items.map((i) => `${i.id} ${i.title}`).join(' ') ?? ''}`
  return q.split(/\s+/).every((t) => hay.toLowerCase().includes(t))
}
const byRecent = (a: PrView, b: PrView) => (b.mergedAt ?? b.updatedAt).localeCompare(a.mergedAt ?? a.updatedAt)

const releases = computed(() => deck.prs.filter((p) => p.flow === 'release' && p.state !== 'CLOSED' && matches(p)).sort(byRecent))
const openReleases = computed(() => releases.value.filter((p) => p.state === 'OPEN'))
const mergedReleases = computed(() => releases.value.filter((p) => p.state === 'MERGED'))
/** Merged into dev but in no release PR yet, per repo */
/** Tags of tag-based repos (newest first per repo), filtered by the search */
const tags = computed(() => {
  const q = v.query.trim().toLowerCase()
  return (deck.overview?.tags ?? []).filter((t) => {
    if (!q) return true
    const hay = `${t.repo} ${t.tag} ${t.jiraKeys.join(' ')} ${t.items.map((i) => `${i.id} ${i.title}`).join(' ')}`.toLowerCase()
    return q.split(/\s+/).every((w) => hay.includes(w))
  })
})
/** The newest tag of each repo starts expanded */
const latestPerRepo = computed(() => {
  const seen = new Set<string>()
  return new Set(tags.value.filter((t) => !seen.has(t.repo) && seen.add(t.repo)).map((t) => t.prId))
})

const unreleased = computed(() => {
  const m = new Map<string, PrView[]>()
  for (const p of deck.prs.filter((p) => isUnreleased(p) && matches(p)).sort(byRecent)) m.set(p.repo, [...(m.get(p.repo) ?? []), p])
  return [...m].map(([repo, prs]) => ({ repo, prs }))
})

const hotfixes = computed(() => deck.prs.filter((p) => p.flow === 'hotfix' && p.state !== 'CLOSED' && matches(p)).sort(byRecent))
const needsBackmerge = computed(() => hotfixes.value.filter((p) => p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged))
const openHotfixes = computed(() => hotfixes.value.filter((p) => p.state === 'OPEN'))
const doneHotfixes = computed(() => hotfixes.value.filter((p) => p.state === 'MERGED' && !(p.backmerge && !p.backmerge.backmerged)))

const groupKeys = computed(() =>
  v.tab === 'releases'
    ? [...releases.value.map((p) => p.id), ...tags.value.map((t) => t.prId), ...unreleased.value.map((u) => `unreleased:${u.repo}`)]
    : ['hf:needs', 'hf:open', 'hf:done'],
)
/** Merged releases and finished hotfixes start collapsed */
const isCollapsed = (key: string, byDefault = false) => v.collapsed[key] ?? byDefault
const allCollapsed = computed(() => groupKeys.value.every((k) => v.collapsed[k]))
const toggleAll = () => {
  const c = !allCollapsed.value
  for (const k of groupKeys.value) v.collapsed[k] = c
}

/** Release being re-read from GitHub (spinner on its button) */
const refreshing = ref<string | null>(null)
async function refresh(id: string) {
  refreshing.value = id
  await deck.mutate(() => api.refreshRelease(id), 'Release contents updated')
  refreshing.value = null
}
</script>

<template>
  <!-- Width cap on the children, not the page, so the scrollbar sits at the far right -->
  <div class="h-page flex flex-col gap-4" :class="{ '*:max-w-6xl': v.tab !== 'graph' }">
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="v.tab !== 'graph'" class="relative w-64 min-w-40 flex-1 sm:flex-none">
        <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
        <Input v-model="v.query" type="search" placeholder="Search PRs, branches, Jira keys…" class="h-8 pl-8" />
      </div>
      <Tabs v-model="v.tab">
        <TabsList>
          <TabsTrigger value="releases" :count="openReleases.length">Releases</TabsTrigger>
          <TabsTrigger value="hotfixes" :count="needsBackmerge.length + openHotfixes.length">Hotfixes</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>
      </Tabs>
      <span class="flex-1" />
      <!-- The graph tab puts its filters and View menu here -->
      <div id="releases-toolbar" class="flex items-center gap-2 empty:hidden" />
      <CollapseAllButton v-if="v.tab !== 'graph' && groupKeys.length > 1" :collapsed="allCollapsed" @toggle="toggleAll" />
    </div>

    <ReleaseGraph v-if="v.tab === 'graph'" />
    <ScrollArea v-else type="auto" class="min-h-0 flex-1 max-w-none!">
      <div class="max-w-6xl space-y-4 p-px">
        <template v-if="v.tab === 'releases'">
          <template v-for="sec in [{ label: 'Open releases', prs: openReleases }, { label: 'Merged releases', prs: mergedReleases }]" :key="sec.label">
          <h3 v-if="sec.prs.length" class="flex items-center gap-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:pt-0">
            {{ sec.label }} <Badge variant="count">{{ sec.prs.length }}</Badge>
          </h3>
          <GroupCard
            v-for="r in sec.prs"
            :key="r.id"
            label=""
            :count="deck.releaseById.get(r.id)?.items.length ?? 0"
            :collapsed="isCollapsed(r.id, r.state === 'MERGED')"
            @update:collapsed="(c: boolean) => (v.collapsed[r.id] = c)"
          >
            <template #label>
              <span class="flex min-w-0 items-center gap-2">
                <Badge :variant="r.state === 'OPEN' ? 'success' : 'merged'" class="shrink-0">{{ r.state === 'OPEN' ? 'Open' : `Merged ${timeAgo(r.mergedAt!)}` }}</Badge>
                <RepoName :id="r.id" class="max-w-64 font-mono text-xs" />
                <span class="flex shrink-0 items-center gap-1 font-mono text-xs font-normal text-muted-foreground"><PhGitBranch :size="12" />{{ r.headRef }} → {{ r.baseRef }}</span>
              </span>
            </template>
            <div class="space-y-2">
              <div class="flex items-center gap-2 rounded-md bg-muted/50">
                <PrRow :pr="r" compact class="min-w-0 flex-1" />
                <Button variant="ghost" size="icon-sm" class="mr-1.5" :disabled="refreshing === r.id" :title="refreshing === r.id ? 'Reading the release from GitHub…' : 'Re-read the release from GitHub'" @click="refresh(r.id)">
                  <PhArrowsClockwise :class="{ 'animate-spin': refreshing === r.id }" />
                </Button>
              </div>
              <ReleaseItems v-if="deck.releaseById.get(r.id)" :contents="deck.releaseById.get(r.id)!" />
              <p v-else class="px-2.5 py-2 text-sm text-muted-foreground">Contents load on the next sync, or refresh now.</p>
            </div>
          </GroupCard>
          </template>

          <template v-if="tags.length">
            <h3 class="flex items-center gap-2 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Tags <Badge variant="count">{{ tags.length }}</Badge>
            </h3>
            <GroupCard
              v-for="t in tags"
              :key="t.prId"
              label=""
              :count="t.items.length"
              :collapsed="isCollapsed(t.prId, !latestPerRepo.has(t.prId))"
              @update:collapsed="(c: boolean) => (v.collapsed[t.prId] = c)"
            >
              <template #label>
                <span class="flex min-w-0 items-center gap-2">
                  <Badge variant="success" class="shrink-0">{{ t.date ? `Tagged ${timeAgo(t.date)}` : 'Tag' }}</Badge>
                  <RepoName :repo="t.repo" class="max-w-64 font-mono text-xs" />
                  <a :href="t.url" target="_blank" rel="noopener" class="shrink-0 font-mono text-xs text-primary hover:underline" @click.stop>{{ t.tag }}</a>
                  <span v-if="t.previous" class="shrink-0 font-mono text-xs font-normal text-muted-foreground">since {{ t.previous }}</span>
                </span>
              </template>
              <ReleaseItems :contents="t" />
            </GroupCard>
          </template>

          <template v-if="unreleased.length">
            <h3 class="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Merged, not in a release yet</h3>
            <GroupCard
              v-for="u in unreleased"
              :key="u.repo"
              :label="u.repo"
              :count="u.prs.length"
              :collapsed="isCollapsed(`unreleased:${u.repo}`)"
              @update:collapsed="(c: boolean) => (v.collapsed[`unreleased:${u.repo}`] = c)"
            >
              <template #label><RepoName :repo="u.repo" class="font-mono text-xs" /></template>
              <div class="-m-1.5 divide-y"><PrRow v-for="p in u.prs" :key="p.id" :pr="p" compact /></div>
            </GroupCard>
          </template>
          <div v-if="!releases.length && !unreleased.length && !tags.length" class="py-16 text-center text-muted-foreground">
            No release PRs found. A release PR targets master/main from dev (or a release/* branch).
          </div>
        </template>

        <template v-else>
          <GroupCard
            v-for="g in [
              { key: 'hf:needs', label: 'Merged, not back in dev yet', prs: needsBackmerge, collapsed: false },
              { key: 'hf:open', label: 'Open', prs: openHotfixes, collapsed: false },
              { key: 'hf:done', label: 'Merged and backmerged', prs: doneHotfixes, collapsed: true },
            ].filter((g) => g.prs.length)"
            :key="g.key"
            :label="g.label"
            :count="g.prs.length"
            :collapsed="isCollapsed(g.key, g.collapsed)"
            @update:collapsed="(c: boolean) => (v.collapsed[g.key] = c)"
          >
            <div class="-m-1.5 divide-y">
              <div v-for="p in g.prs" :key="p.id">
                <PrRow :pr="p" />
                <div v-if="p.state === 'MERGED' && p.backmerge" class="flex items-center gap-1.5 px-2.5 pb-2 text-xs" :class="p.backmerge.backmerged ? 'text-success' : 'text-warning'">
                  <PhCheckCircle v-if="p.backmerge.backmerged" :size="14" weight="fill" />
                  <PhWarning v-else :size="14" weight="fill" />
                  <template v-if="p.backmerge.backmerged">In {{ p.backmerge.into }}</template>
                  <template v-else-if="p.backmerge.error">Couldn't check {{ p.backmerge.into }}: {{ p.backmerge.error }}</template>
                  <template v-else>
                    Not in {{ p.backmerge.into }} yet
                    <template v-if="p.backmergePr">
                      · backmerge
                      <button class="font-mono text-primary hover:underline" @click="deck.selectedId = p.backmergePr"><RepoName :id="p.backmergePr" /></button> is open
                    </template>
                    <template v-else> · merge {{ p.baseRef }} back into {{ p.backmerge.into }}</template>
                  </template>
                </div>
              </div>
            </div>
          </GroupCard>
          <div v-if="!hotfixes.length" class="py-16 text-center text-muted-foreground">
            No hotfixes. A hotfix targets master/main directly in a repo that releases from dev.
          </div>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
