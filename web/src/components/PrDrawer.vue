<script setup lang="ts">
import { useArrowNav } from '@/composables/prNav'
import { useDependencies } from '@/composables/dependencies'
import { followBeside, openBeside } from '@/composables/besideWindow'
import { loadPrDetail } from '@/composables/prDetail'
import { releaseStatus } from '@shared/release'
import SidePanel from './SidePanel.vue'
import { computed, ref, watch } from 'vue'
import {
  PhArrowSquareOut,
  PhArrowsClockwise,
  PhTrain,
  PhInfo,
  PhWarning,
  PhCheckCircle,
  PhGitBranch,
  PhCaretDown,
  PhPlus,
  PhPushPin,
  PhSquareSplitHorizontal,
  PhRocketLaunch,
  PhTrash,
  PhXCircle,
} from '@phosphor-icons/vue'
import type { DepEdge, PrDetail } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { useRouter } from 'vue-router'
import { ACTION_TONE, CHECK_STYLE, jiraCardTone, timeAgo } from '@/utils/format'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraTransition from './JiraTransition.vue'
import ThreadList from './ThreadList.vue'
import PrDescription from './PrDescription.vue'
import PrFiles from './PrFiles.vue'
import JiraLinks from './JiraLinks.vue'
import RepoName from './RepoName.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import SectionToggle from './SectionToggle.vue'
import ReleaseItems from './ReleaseItems.vue'
import { FLOW_LABEL } from '@/utils/releaseFlow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const router = useRouter()
const releasesView = useLayout().view('releases', { tab: 'releases' as string })
/** The action's badge tone, where alerts have a matching one */
const alertTone = computed(() => {
  const t = pr.value ? ACTION_TONE[pr.value.action.kind] : 'default'
  return t === 'destructive' || t === 'warning' || t === 'success' || t === 'info' ? t : 'default'
})
const dv = useLayout().view('drawer', {
  tab: 'details' as 'details' | 'contents' | 'description' | 'files' | 'conversations',
  // Last dependency type used in the add form
  depDirection: 'dependsOn' as 'dependsOn' | 'blocks',
  depKind: 'merge' as 'merge' | 'release',
  // Collapsible footer sections
  depsOpen: true,
  noteOpen: true,
})
useArrowNav('pr', () => deck.selectedId, (id) => (deck.selectedId = id))
const pr = computed(() => deck.selected)
const refreshing = ref(false)
async function refreshContents() {
  refreshing.value = true
  await deck.mutate(() => api.refreshRelease(pr.value!.id), 'Release contents updated')
  refreshing.value = false
}
/** Contents only exists for release PRs; others show Details instead */
const tab = computed(() => (dv.tab === 'contents' && pr.value?.flow !== 'release' ? 'details' : dv.tab))
const contents = computed(() => (pr.value ? deck.releaseById.get(pr.value.id) : undefined))
const ALERT_ICON = { default: PhInfo, info: PhInfo, success: PhCheckCircle, warning: PhWarning, destructive: PhXCircle } as const
/** The release train this release PR is part of, and its place in it */
const train = computed(() => {
  const id = pr.value?.id
  const t = id ? deck.overview?.trains.find((t) => t.releases.includes(id)) : undefined
  if (!t || !id) return null
  return {
    step: t.releases.indexOf(id) + 1,
    ordered: t.links.some((l) => l.kind === 'order'),
    total: t.releases.length,
    next: t.next === id,
    after: t.links.filter((l) => l.kind === 'order' && l.to === id).map((l) => l.from),
    with: t.releases.filter((r) => r !== id && !t.links.some((l) => l.kind === 'order' && (l.from === r || l.to === r) && (l.from === id || l.to === id))),
  }
})
function openTrains() {
  releasesView.tab = 'trains'
  router.push('/releases')
}
/** Banner: the next step, why, and where the release stands (merged PRs) */
const banner = computed(() => {
  const p = pr.value
  if (!p) return null
  const lines = p.action.detail ? [p.action.detail] : []
  // The exact tag (releasedIn, shown below) is more precise than "in the latest tag"
  if (p.state === 'MERGED' && p.release && !p.releasedIn) {
    const r = releaseStatus(p.release).long
    if (!lines.includes(r)) lines.push(r)
  }
  const c = contents.value
  if (p.flow === 'release')
    lines.push(c ? `${p.state === 'MERGED' ? 'Shipped' : 'Ships'} ${c.items.length} PR(s) and ${c.jiraKeys.length} Jira issue(s) from ${p.headRef} to ${p.baseRef}.` : `Release from ${p.headRef} to ${p.baseRef}; contents load on the next sync.`)
  const hasContext = lines.length || p.shipsIn.length || (p.backmerge && p.state === 'MERGED') || p.releasedIn || train.value
  if (!hasContext && (p.action.kind === 'none' || p.action.kind === 'done')) return null
  return { title: p.action.label, lines }
})
const jira = computed(() => (pr.value?.jiraKeys ?? []).map((k) => ({ key: k, issue: deck.jiraByKey.get(k) })))

// ---- Description / Files: loaded when one of those tabs is shown (cache shared with card previews)
const detail = ref<PrDetail | null>(null)
const detailFor = ref('')
const detailError = ref('')
watch(
  () => [pr.value?.id, pr.value?.updatedAt, dv.tab] as const,
  async ([id, updatedAt, tab]) => {
    if (!id || !updatedAt || (tab !== 'description' && tab !== 'files')) return
    const key = `${id}|${updatedAt}`
    if (detailFor.value === key && detail.value) return
    detail.value = null
    detailError.value = ''
    try {
      const d = await loadPrDetail({ id, updatedAt })
      if (pr.value?.id === id) ((detail.value = d), (detailFor.value = key))
    } catch (e) {
      if (pr.value?.id === id) detailError.value = (e as Error).message
    }
  },
  { immediate: true },
)
// The beside window follows the PR shown here
watch(() => pr.value?.url, (url) => url && followBeside(url))

const note = ref('')
watch(pr, (p) => (note.value = p?.note ?? ''), { immediate: true })
const saveMeta = (pinned = pr.value!.pinned) => deck.mutate(() => api.setMeta(pr.value!.id, note.value, pinned))

const depTarget = ref('')
const candidates = computed(() => deck.prs.filter((p) => p.id !== pr.value?.id).map((p) => p.id))
async function addDep() {
  const [from, to] = dv.depDirection === 'dependsOn' ? [pr.value!.id, depTarget.value] : [depTarget.value, pr.value!.id]
  if (await deps.add(from, to, dv.depKind)) depTarget.value = ''
}
/** Prerequisites not yet merged/released */
const waiting = computed(() => pr.value?.dependsOn.filter((e) => !e.satisfied).length ?? 0)
const deps = useDependencies()
const removeDep = (e: DepEdge) => deps.remove(e)

</script>

<template>
  <SidePanel :open="!!pr" @close="deck.selectedId = null">
    <template v-if="pr" #header>
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge :variant="ACTION_TONE[pr.action.kind]">{{ pr.action.label }}</Badge>
            <Badge variant="outline">{{ pr.state }}{{ pr.isDraft ? ' · draft' : '' }}</Badge>
            <Badge v-if="pr.flow" :variant="pr.flow === 'hotfix' ? 'warning' : pr.flow === 'release' ? 'merged' : 'muted'">{{ FLOW_LABEL[pr.flow] }}</Badge>
            <Badge v-for="r in pr.relations" :key="r" variant="muted">{{ r.replace('_', ' ') }}</Badge>
          </div>
          <h2 class="leading-snug font-semibold">{{ pr.title }}</h2>
          <a :href="pr.url" target="_blank" rel="noopener" class="mt-1 flex min-w-0 items-center gap-1 font-mono text-sm text-primary hover:underline">
            <RepoName :id="pr.id" /><PhArrowSquareOut :size="14" class="shrink-0" />
          </a>
    </template>
    <template v-if="pr" #actions>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Open beside" @click="openBeside(pr.url)"><PhSquareSplitHorizontal /></Button>
          </TooltipTrigger>
          <TooltipContent>Open on GitHub in a window beside this one (follows the PR you select)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="saveMeta(!pr.pinned)">
              <PhPushPin :weight="pr.pinned ? 'fill' : 'regular'" :class="{ 'text-primary': pr.pinned }" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pr.pinned ? 'Unpin' : 'Pin to top of lists' }}</TooltipContent>
        </Tooltip>
    </template>

      <Tabs v-if="pr" :model-value="tab" class="min-h-0 flex-1 gap-0" @update:model-value="(t) => (dv.tab = t as typeof dv.tab)">
        <div class="border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger v-if="pr.flow === 'release'" value="contents" :count="contents?.items.length ?? 0">Contents</TabsTrigger>
            <TabsTrigger value="description">Description</TabsTrigger>
            <TabsTrigger value="files" :count="pr.changedFiles">Files</TabsTrigger>
            <TabsTrigger value="conversations" :count="pr.threads.length">Conversations</TabsTrigger>
          </TabsList>
        </div>

      <TabsContent v-for="t in ['description', 'files'] as const" :key="t" :value="t" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="p-4">
            <p v-if="detailError" class="text-sm text-destructive">{{ detailError }}</p>
            <template v-else-if="detail">
              <PrDescription v-if="t === 'description'" :html="detail.bodyHTML" />
              <PrFiles v-else :key="pr.id" :files="detail.files" :truncated="detail.filesTruncated" :pr-url="pr.url" />
            </template>
            <div v-else class="space-y-2"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" /></div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="contents" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="space-y-3 p-4">
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span class="flex-1">
                <template v-if="contents">Ships {{ contents.items.length }} PR(s) and {{ contents.jiraKeys.length }} Jira issue(s) · checked {{ timeAgo(contents.fetchedAt) }}</template>
                <template v-else>Not read yet</template>
              </span>
              <Button variant="outline" size="sm" :disabled="refreshing" @click="refreshContents">
                <PhArrowsClockwise :class="{ 'animate-spin': refreshing }" /> {{ refreshing ? 'Refreshing…' : 'Refresh' }}
              </Button>
            </div>
            <ReleaseItems v-if="contents" :contents="contents" class="-mx-2.5" />
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="conversations" class="min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="p-4">
            <ThreadList v-if="pr.threads.length" :threads="pr.threads" />
            <p v-else-if="pr.unresolvedThreads" class="py-10 text-center text-sm text-muted-foreground">
              {{ pr.unresolvedThreads }} unresolved conversation(s). Details load on the next sync.
            </p>
            <p v-else class="py-10 text-center text-sm text-muted-foreground">No unresolved conversations.</p>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="details" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <div class="space-y-5 p-4">
          <!-- Status: what this PR needs next, with release flow context -->
          <Alert v-if="banner" :variant="alertTone">
            <component :is="ALERT_ICON[alertTone]" />
            <AlertTitle>{{ banner.title }}</AlertTitle>
            <AlertDescription>
              <p v-for="l in banner.lines" :key="l">{{ l }}</p>
              <p v-if="pr.shipsIn.length" class="flex flex-wrap items-center gap-x-1.5">
                <PhRocketLaunch :size="14" class="self-center" />
                <template v-for="(s, i) in pr.shipsIn" :key="s.id">
                  <span>{{ i ? 'and' : s.state === 'OPEN' ? 'Ships in' : 'Shipped via' }}</span>
                  <button class="font-mono text-primary hover:underline" @click="deck.selectedId = s.id"><RepoName :id="s.id" /></button>
                  <span v-if="i === 0 && s.state === 'OPEN'" class="text-muted-foreground">(open release)</span>
                </template>
              </p>
              <p v-if="train" class="flex flex-wrap items-center gap-x-1.5">
                <PhTrain :size="14" class="self-center" />
                <button class="hover:underline" @click="openTrains">{{ train.ordered ? `Release train: step ${train.step} of ${train.total}` : `Release train of ${train.total}` }}</button>
                <Badge v-if="train.next" variant="primary" class="h-4 px-1.5 text-[10px]">Ship next</Badge>
                <template v-if="train.after.length">
                  · after
                  <button v-for="a in train.after" :key="a" class="font-mono text-primary hover:underline" @click="deck.selectedId = a"><RepoName :id="a" /></button>
                </template>
                <template v-if="train.with.length">
                  · with
                  <button v-for="w in train.with" :key="w" class="font-mono text-primary hover:underline" @click="deck.selectedId = w"><RepoName :id="w" /></button>
                </template>
              </p>
              <p v-if="pr.releasedIn" class="flex items-center gap-1.5">
                <PhRocketLaunch :size="14" />Released in
                <a :href="pr.releasedIn.url" target="_blank" rel="noopener" class="font-mono text-primary hover:underline">{{ pr.releasedIn.tag }}</a>
              </p>
              <p v-if="pr.backmerge && pr.state === 'MERGED'">
                <template v-if="pr.backmerge.backmerged">Back in {{ pr.backmerge.into }}.</template>
                <template v-else-if="pr.backmergePr">
                  Backmerge <button class="font-mono text-primary hover:underline" @click="deck.selectedId = pr.backmergePr"><RepoName :id="pr.backmergePr" /></button> is open.
                </template>
              </p>
            </AlertDescription>
            <AlertAction v-if="pr.flow === 'release' && dv.tab !== 'contents'">
              <Button size="sm" variant="outline" @click="dv.tab = 'contents'">View contents ({{ contents?.items.length ?? 0 }})</Button>
            </AlertAction>
          </Alert>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Branch</div>
              <div class="flex items-start gap-1 font-mono text-xs"><PhGitBranch :size="14" class="mt-px shrink-0" /><span class="min-w-0 break-all">{{ pr.headRef }} → {{ pr.baseRef }}</span></div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Author</div>
              <div>{{ pr.author.login }} · opened {{ timeAgo(pr.createdAt) }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Size</div>
              <div><span class="text-success">+{{ pr.additions }}</span> <span class="text-destructive">−{{ pr.deletions }}</span> · {{ pr.changedFiles }} files</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Checks</div>
              <div :class="CHECK_STYLE[pr.checks.state].cls">{{ CHECK_STYLE[pr.checks.state].label }} ({{ pr.checks.total }})</div>
            </div>
            <div v-if="pr.mergeable === 'CONFLICTING'" class="col-span-2 text-destructive">Merge conflicts with {{ pr.baseRef }}</div>
          </div>

          <section v-if="pr.checks.failing.length">
            <h3 class="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Failing checks</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="f in pr.checks.failing" :key="f.name" class="flex items-center gap-2">
                <PhXCircle :size="14" weight="fill" class="text-destructive" />
                <a :href="f.url ?? undefined" target="_blank" class="hover:underline">{{ f.name }}</a>
              </li>
            </ul>
          </section>

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Reviews</h3>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="r in pr.reviews" :key="r.login" :variant="r.state === 'APPROVED' ? 'success' : r.state === 'CHANGES_REQUESTED' ? 'warning' : 'muted'">
                <PhCheckCircle v-if="r.state === 'APPROVED'" />{{ r.login }}
              </Badge>
              <Badge v-for="r in pr.requestedReviewers" :key="'rq' + r.login" variant="outline">{{ r.isTeam ? 'team/' : '' }}{{ r.login }} · requested</Badge>
              <span v-if="!pr.reviews.length && !pr.requestedReviewers.length" class="text-sm text-muted-foreground">No reviews yet</span>
            </div>
            <button v-if="pr.unresolvedThreads" class="mt-1 text-xs text-warning hover:underline" @click="dv.tab = 'conversations'">
              {{ pr.unresolvedThreads }} unresolved conversation(s)
            </button>
          </section>

          <Separator />

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Jira</h3>
            <div v-if="!jira.length" class="text-sm text-muted-foreground">No issue key found in title or branch.</div>
            <div v-for="{ key, issue } in jira" :key="key" :class="['mb-2 rounded-lg border p-3', issue && jiraCardTone(issue.statusCategory)]">
              <template v-if="issue">
                <div class="flex items-center gap-2">
                  <img v-if="issue.typeIconUrl" :src="issue.typeIconUrl" class="size-4" alt="" />
                  <a :href="issue.url" target="_blank" class="font-mono text-sm hover:underline">{{ issue.key }}</a>
                  <span class="flex-1" />
                  <JiraTransition :issue-key="issue.key" />
                </div>
                <div class="mt-1 text-sm">{{ issue.summary }}</div>
                <div class="mt-1 text-xs text-muted-foreground">
                  {{ issue.assignee?.displayName ?? 'Unassigned' }}<template v-if="issue.fixVersions.length"> · fix: {{ issue.fixVersions.join(', ') }}</template>
                </div>
<JiraLinks :links="issue.links" class="mt-2" />
              </template>
              <span v-else class="font-mono text-sm">{{ key }} <span class="text-muted-foreground">(not synced)</span></span>
            </div>
          </section>


        </div>
      </ScrollArea>
      </TabsContent>
      </Tabs>
    <!-- Always visible at the bottom, whichever tab is open -->
    <template v-if="pr" #footer>
      <div class="w-full space-y-3">
        <section>
          <SectionToggle v-model:open="dv.depsOpen" label="Dependencies">
            <Badge variant="count">{{ pr.dependsOn.length + pr.dependents.length }}</Badge>
            <Badge v-if="waiting" variant="warning" class="h-4 px-1.5 text-[10px]">{{ waiting }} waiting</Badge>
          </SectionToggle>
          <div v-show="dv.depsOpen" class="mt-2 max-h-[35vh] overflow-y-auto pr-1">
            <h4 class="mb-1 text-xs text-muted-foreground">Depends on: merge these first</h4>
            <ul class="space-y-1">
              <li v-for="e in pr.dependsOn" :key="e.to" class="flex items-center gap-2 text-sm">
                <PhCheckCircle v-if="e.satisfied" :size="16" weight="fill" class="shrink-0 text-success" />
                <PhXCircle v-else :size="16" class="shrink-0 text-warning" />
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.to"><RepoName :id="e.to" /></button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.to)?.title ?? (e.missing ? '(not synced yet)' : '') }}</span>
                <span class="flex-1" />
                <Badge variant="outline">{{ e.kind }}</Badge>
                <Badge variant="muted" :title="e.note ?? ''">{{ e.source }}</Badge>
                <Button v-if="deps.canRemove(e)" variant="ghost" size="icon-xs" :title="e.id != null ? 'Remove' : 'Remove from the PR description'" @click="removeDep(e)"><PhTrash /></Button>
              </li>
              <li v-if="!pr.dependsOn.length" class="text-sm text-muted-foreground">None</li>
            </ul>
            <h4 class="mt-3 mb-1 text-xs text-muted-foreground">Blocks: waiting on this</h4>
            <ul class="space-y-1">
              <li v-for="e in pr.dependents" :key="e.from" class="flex items-center gap-2 text-sm">
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.from"><RepoName :id="e.from" /></button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.from)?.title }}</span>
                <span class="flex-1" />
                <Badge variant="outline">waits for {{ e.kind }}</Badge>
                <Button v-if="deps.canRemove(e)" variant="ghost" size="icon-xs" :title="e.id != null ? 'Remove' : 'Remove from the PR description'" @click="removeDep(e)"><PhTrash /></Button>
              </li>
              <li v-if="!pr.dependents.length" class="text-sm text-muted-foreground">None</li>
            </ul>

            <form class="mt-3 space-y-2 rounded-lg bg-muted/60 p-3" @submit.prevent="addDep">
              <div class="flex gap-2">
                <Input v-model="depTarget" list="pr-candidates" placeholder="owner/repo#123 or PR URL" class="h-8 min-w-0 flex-1" required />
                <datalist id="pr-candidates"><option v-for="c in candidates" :key="c" :value="c" /></datalist>
                <!-- Split button: add with the current choice, or switch direction / kind from the menu -->
                <ButtonGroup class="shrink-0">
                  <Button size="sm" type="submit">
                    <PhPlus /> {{ dv.depDirection === 'dependsOn' ? 'Depends on' : 'Blocks' }}
                    <span class="opacity-75">· {{ dv.depKind }}</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button size="icon-sm" type="button" aria-label="Choose dependency type" class="border-l border-primary-foreground/20">
                        <PhCaretDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-56">
                      <DropdownMenuLabel class="text-xs text-muted-foreground">This PR…</DropdownMenuLabel>
                      <DropdownMenuRadioGroup v-model="dv.depDirection">
                        <DropdownMenuRadioItem value="dependsOn">depends on it</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="blocks">blocks it</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel class="text-xs text-muted-foreground">…waits for</DropdownMenuLabel>
                      <DropdownMenuRadioGroup v-model="dv.depKind">
                        <DropdownMenuRadioItem value="merge">the merge</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="release">the release</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ dv.depDirection === 'dependsOn' ? 'Written into this PR’s description' : 'Written into that PR’s description' }} as “{{ dv.depKind === 'release' ? 'Requires release of' : 'Depends on' }}: org/repo#12”, so it shows on GitHub too.
              </p>
            </form>
          </div>
        </section>
        <SectionToggle v-if="!dv.noteOpen" v-model:open="dv.noteOpen" label="My note">
          <span v-if="note.trim()" class="truncate text-xs text-muted-foreground normal-case">{{ note.trim().split('\n')[0] }}</span>
        </SectionToggle>
        <MarkdownEditor v-else v-model="note" placeholder="Private note… (Markdown)" :height="96" state-key="pr-note" class="w-full" @blur="saveMeta()">
          <template #label>
            <SectionToggle v-model:open="dv.noteOpen" label="My note" />
          </template>
        </MarkdownEditor>
      </div>
    </template>
  </SidePanel>
</template>

