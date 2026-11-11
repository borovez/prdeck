<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretRight, PhCheckCircle, PhCircle, PhCircleDashed, PhEye, PhPlus, PhRocketLaunch, PhSlidersHorizontal, PhWarning } from '@phosphor-icons/vue'
import { isUnreleased } from '@/utils/releaseFlow'
import { useReleaseNav } from '@/composables/releaseNav'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type PanelConfig, type PanelType } from '@/stores/layout'
import { jiraTone, timeAgo } from '@/utils/format'
import { type PrFocus } from '@/utils/prFocus'
import DashPanel from '@/components/DashPanel.vue'
import RepoName from '@/components/RepoName.vue'
import PrRow from '@/components/PrRow.vue'
import SlackList from '@/components/SlackList.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

const deck = useDeck()
const layout = useLayout()

const PR_SORTS = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'repo', label: 'Repo' },
  { value: 'size', label: 'Size' },
]
const TIME_SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

const prsFor = (p: PanelConfig): PrView[] => sortPrs(filterPrs(deck.prs, p.filter), p.sort, p.dir)
const slackNew = computed(() => (deck.overview?.slack ?? []).filter((i) => i.status === 'new'))
const slackFor = (p: PanelConfig) => (p.sort === 'oldest' ? [...slackNew.value].reverse() : slackNew.value)
const myJira = computed(() => (deck.overview?.jira ?? []).filter((j) => j.isMine && j.statusCategory !== 'done'))
const openChains = computed(() => (deck.overview?.chains ?? []).filter((c) => !c.done))
/** Releases panel: open releases, hotfixes not back in dev, my merged work not in a release yet */
const shipNextIds = computed(() => new Set((deck.overview?.trains ?? []).map((t) => t.next).filter(Boolean)))
// "Ship next" releases first
const openReleases = computed(() =>
  deck.prs.filter((p) => p.flow === 'release' && p.state === 'OPEN').sort((a, b) => Number(shipNextIds.value.has(b.id)) - Number(shipNextIds.value.has(a.id))),
)
const needsBackmerge = computed(() => deck.prs.filter((p) => p.flow === 'hotfix' && p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged))
const myUnreleased = computed(() => deck.prs.filter((p) => p.isMine && isUnreleased(p)))
const releaseNav = useReleaseNav()

function itemsFor(p: PanelConfig): number {
  if (p.type === 'prs') return prsFor(p).length
  if (p.type === 'slack') return slackNew.value.length
  if (p.type === 'jira') return myJira.value.length
  if (p.type === 'releases') return openReleases.value.length + needsBackmerge.value.length
  return openChains.value.length
}

const visible = computed(() => layout.orderedPanels.filter((p) => p.visible))
const hidden = computed(() => layout.prefs.panels.filter((p) => !p.visible))

const stats = computed(() => deck.overview?.stats)
interface Tile {
  label: string
  value: number
  cls: string
  hint?: string
  /** Opens the PR page with this quick filter, or another page */
  focus?: PrFocus
  to?: string
}
const tiles = computed<Tile[]>(() => {
  const s = stats.value
  const next = openReleases.value.find((r) => shipNextIds.value.has(r.id))
  return [
    { label: 'Needs action', value: s?.action ?? 0, cls: 'text-primary', focus: 'action' },
    { label: 'Review requests', value: s?.reviewRequests ?? 0, cls: '', focus: 'review' },
    { label: 'Blocked', value: s?.blocked ?? 0, cls: 'text-warning', focus: 'blocked' },
    { label: 'My open PRs', value: s?.mine ?? 0, cls: '', focus: 'mine' },
    {
      label: 'Unresolved conversations',
      value: s?.myThreads ?? 0,
      cls: s?.myThreads ? 'text-warning' : '',
      hint: s?.myThreads ? `on ${s.myThreadPrs} of my PRs` : undefined,
      focus: 'threads',
    },
    { label: 'Slack to handle', value: s?.slackNew ?? 0, cls: '', to: '/slack' },
    {
      label: 'Open releases',
      value: openReleases.value.length,
      // Hotfixes missing from dev matter most; else what ships next
      cls: needsBackmerge.value.length ? 'text-warning' : '',
      hint: needsBackmerge.value.length ? `${needsBackmerge.value.length} hotfix(es) not in dev` : next ? `next: ${next.repo.split('/')[1]}#${next.number}` : undefined,
      to: '/releases',
    },
  ]
})
const router = useRouter()
const prsView = layout.view('prs', {} as { focus?: PrFocus | ''; scope?: string; query?: string; repo?: string })
function openTile(t: Tile) {
  if (t.focus) {
    // Show exactly what the tile counts: clear the scope tab, search and repo filter
    Object.assign(prsView, { focus: t.focus, scope: 'all', query: '', repo: '' })
    router.push('/prs')
  } else if (t.to) router.push(t.to)
}

function addPanel(type: PanelType) {
  const titles: Record<PanelType, string> = { prs: 'Custom PR list', slack: 'Slack', jira: 'Jira', chains: 'Chains', releases: 'Releases' }
  layout.addPanel(type, titles[type], type === 'prs' ? { mine: true } : {})
}
const stateOf = (id: string) => deck.byId.get(id)
const stepDone = (id: string) => stateOf(id)?.state === 'MERGED' && (stateOf(id)?.release?.released ?? true)
</script>

<template>
  <div class="space-y-4">
    <div class="flex min-h-8 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <template v-if="hidden.length">
        Hidden:
        <Button v-for="p in hidden" :key="p.id" variant="ghost" size="xs" @click="layout.update(p.id, { visible: true })">
          <PhEye /> {{ p.title }}
        </Button>
      </template>
      <span class="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm"><PhSlidersHorizontal /> Customize</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-64">
          <DropdownMenuLabel>Panels</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            v-for="p in layout.prefs.panels"
            :key="p.id"
            :model-value="p.visible"
            @select.prevent
            @update:model-value="layout.update(p.id, { visible: !!$event })"
          >
            {{ p.title }}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><PhPlus /> Add panel</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem @select="addPanel('prs')">PR list (filterable)</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('slack')">Slack inbox</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('jira')">Jira tasks</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('releases')">Releases</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem v-model="layout.prefs.dense" @select.prevent>Compact rows</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="layout.reset()">Reset layout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <button
        v-for="t in tiles"
        :key="t.label"
        type="button"
        class="group rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        @click="openTile(t)"
      >
      <Card class="h-full gap-0 py-3 transition-colors group-hover:bg-accent">
        <CardContent class="px-4">
          <div class="truncate text-xs text-muted-foreground" :title="t.label">{{ t.label }}</div>
          <div class="flex items-baseline gap-2">
            <span class="text-2xl font-semibold tabular-nums" :class="t.cls">{{ t.value }}</span>
            <span v-if="t.hint" class="truncate text-xs text-muted-foreground">{{ t.hint }}</span>
          </div>
        </CardContent>
      </Card>
      </button>
    </div>

    <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <DashPanel
        v-for="p in visible"
        :key="p.id"
        :panel="p"
        :count="itemsFor(p)"
        :sort-options="p.type === 'prs' ? PR_SORTS : p.type === 'slack' ? TIME_SORTS : undefined"
      >
        <template v-if="p.type === 'prs'" #menu>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-xs text-muted-foreground">Filter</DropdownMenuLabel>
          <DropdownMenuCheckboxItem :model-value="!!p.filter.mine" @select.prevent @update:model-value="p.filter.mine = !!$event">Only mine</DropdownMenuCheckboxItem>
          <div class="space-y-1.5 px-2 pb-2">
            <Input class="h-7 text-xs" :model-value="p.filter.repo ?? ''" list="dash-repos" placeholder="Repo (any)" @change="p.filter.repo = ($event.target as HTMLInputElement).value || undefined" @keydown.stop />
            <datalist id="dash-repos"><option v-for="r in deck.repos" :key="r" :value="r" /></datalist>
            <Input class="h-7 text-xs" :model-value="p.filter.query ?? ''" placeholder="Text filter…" @change="p.filter.query = ($event.target as HTMLInputElement).value" @keydown.stop />
          </div>
        </template>

        <template #default>
          <!-- PR lists -->
          <template v-if="p.type === 'prs'">
            <PrRow v-for="pr in prsFor(p).slice(0, p.limit)" :key="pr.id" :pr="pr" :compact="layout.prefs.dense" />
            <div v-if="!prsFor(p).length" class="p-6 text-center text-sm text-muted-foreground">Nothing here 🎉</div>
            <Button v-else-if="prsFor(p).length > p.limit" variant="ghost" size="xs" class="w-full" as-child>
              <RouterLink to="/prs">{{ prsFor(p).length - p.limit }} more…</RouterLink>
            </Button>
          </template>

          <!-- Slack -->
          <template v-else-if="p.type === 'slack'">
            <div v-if="!deck.overview?.configured.slack" class="p-6 text-center text-sm text-muted-foreground">
              Slack isn't connected. <RouterLink to="/settings" class="text-primary hover:underline">Set it up</RouterLink>
            </div>
            <SlackList :items="slackFor(p).slice(0, p.limit)" class="-m-1.5 [&>section:last-child_[data-slack-id]:last-child]:rounded-b-xl" />
            <div v-if="deck.overview?.configured.slack && !slackNew.length" class="p-6 text-center text-sm text-muted-foreground">Inbox zero</div>
          </template>

          <!-- Jira -->
          <template v-else-if="p.type === 'jira'">
            <div v-if="!deck.overview?.configured.jira" class="p-6 text-center text-sm text-muted-foreground">
              Jira isn't connected. <RouterLink to="/settings" class="text-primary hover:underline">Set it up</RouterLink>
            </div>
            <a
              v-for="j in myJira.slice(0, p.limit)"
              :key="j.key"
              :href="j.url"
              target="_blank"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent"
            >
              <img v-if="j.typeIconUrl" :src="j.typeIconUrl" class="size-4" alt="" />
              <span class="font-mono text-xs">{{ j.key }}</span>
              <span class="flex-1 truncate">{{ j.summary }}</span>
              <Badge v-if="j.prs.length" variant="muted">{{ j.prs.length }} PR</Badge>
              <Badge :variant="jiraTone(j.statusCategory)">{{ j.status }}</Badge>
            </a>
          </template>

          <!-- Releases -->
          <template v-else-if="p.type === 'releases'">
            <div v-if="!openReleases.length && !needsBackmerge.length && !myUnreleased.length" class="p-6 text-center text-sm text-muted-foreground">
              No open releases or hotfixes waiting.
            </div>
            <section v-if="openReleases.length">
              <h4 class="px-3 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">Open releases</h4>
              <PrRow v-for="r in openReleases.slice(0, p.limit)" :key="r.id" :pr="r" compact>
                <template #badges>
                  <Badge v-if="shipNextIds.has(r.id)" variant="primary">Ship next</Badge>
                  <Badge variant="count" :title="`${deck.releaseById.get(r.id)?.items.length ?? 0} PR(s) in this release`">{{ deck.releaseById.get(r.id)?.items.length ?? 0 }}</Badge>
                </template>
              </PrRow>
            </section>
            <section v-if="needsBackmerge.length">
              <h4 class="flex items-center gap-1.5 px-3 pt-2 pb-0.5 text-xs font-medium text-warning"><PhWarning :size="13" weight="fill" />Hotfixes not back in dev</h4>
              <PrRow v-for="h in needsBackmerge.slice(0, p.limit)" :key="h.id" :pr="h" compact />
            </section>
            <button
              v-if="myUnreleased.length"
              class="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              @click="releaseNav.openReleases(myUnreleased[0].id)"
            >
              <PhRocketLaunch :size="15" class="text-muted-foreground" />
              <span class="flex-1">{{ myUnreleased.length }} of my merged PR(s) aren't in a release yet</span>
              <PhCaretRight :size="13" class="text-muted-foreground" />
            </button>
            <Button variant="ghost" size="xs" class="w-full" as-child><RouterLink to="/releases">Open Releases</RouterLink></Button>
          </template>

          <!-- Chains -->
          <template v-else-if="p.type === 'chains'">
            <div v-if="!openChains.length" class="p-4 text-sm text-muted-foreground">
              No cross-PR dependencies yet. Add one from a PR's detail panel, or write
              <code class="rounded bg-muted px-1 text-xs">Depends on: org/repo#12</code> in a PR description.
            </div>
            <div v-for="c in openChains.slice(0, p.limit)" :key="c.id" class="rounded-lg px-3 py-2 hover:bg-accent/60">
              <div class="mb-2 text-xs text-muted-foreground">{{ c.repos.join(' · ') }}</div>
              <ol class="flex flex-wrap items-center gap-1 text-xs">
                <li v-for="(id, i) in c.prs" :key="id" class="flex items-center gap-1">
                  <span v-if="i" class="text-muted-foreground">→</span>
                  <button
                    class="flex items-center gap-1 rounded-md border px-2 py-1 transition-colors hover:bg-accent"
                    :class="id === c.nextStep ? 'border-primary bg-primary/10' : ''"
                    @click="deck.selectedId = id"
                  >
                    <PhCheckCircle v-if="stepDone(id)" weight="fill" class="text-success" />
                    <PhCircle v-else-if="id === c.nextStep" weight="fill" class="text-primary" />
                    <PhCircleDashed v-else class="text-muted-foreground" />
                    <RepoName :id="id" class="max-w-56 font-mono" />
                    <span class="max-w-36 truncate text-muted-foreground">{{ stateOf(id)?.action.label ?? 'not synced' }}</span>
                  </button>
                </li>
              </ol>
            </div>
          </template>
        </template>
      </DashPanel>
    </div>

    <p class="text-center text-xs text-muted-foreground">
      Drag panels by their handle to reorder · pin, collapse, resize and sort from each panel header · layout saves automatically
      <template v-if="deck.overview?.sync.lastFinishedAt"> · synced {{ timeAgo(deck.overview.sync.lastFinishedAt) }}</template>
    </p>
  </div>
</template>
