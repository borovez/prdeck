<script setup lang="ts">
import { onEscape } from '@/composables/escape'
import { usePrArrowNav } from '@/composables/prNav'
import { computed, ref, watch } from 'vue'
import {
  PhArrowSquareOut,
  PhCheckCircle,
  PhGitBranch,
  PhPlus,
  PhPushPin,
  PhRocketLaunch,
  PhTrash,
  PhX,
  PhXCircle,
} from '@phosphor-icons/vue'
import type { DepEdge, JiraLink } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { ACTION_TONE, CHECK_STYLE, jiraTone, shortId, timeAgo } from '@/utils/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraTransition from './JiraTransition.vue'
import ThreadList from './ThreadList.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
/** Blocking links first, then the rest; Jira can return the same link twice */
const LINK_ORDER = ['is blocked by', 'blocks']
function sortedLinks(links: JiraLink[]) {
  const seen = new Set<string>()
  return links
    .filter((l) => !seen.has(l.label + l.key) && seen.add(l.label + l.key))
    .sort((a, b) => {
      const rank = (l: JiraLink) => (LINK_ORDER.indexOf(l.label) + 1 || LINK_ORDER.length + 1)
      return rank(a) - rank(b) || a.label.localeCompare(b.label)
    })
}
const jiraUrl = (key: string) => (deck.overview?.jiraBaseUrl ? `${deck.overview.jiraBaseUrl}/browse/${key}` : undefined)
const dv = useLayout().view('drawer', { tab: 'details' as 'details' | 'conversations' })
onEscape(() => !!deck.selectedId && ((deck.selectedId = null), true))
usePrArrowNav(() => deck.selectedId, (id) => (deck.selectedId = id))
const layout = useLayout()
const pr = computed(() => deck.selected)
const jira = computed(() => (pr.value?.jiraKeys ?? []).map((k) => ({ key: k, issue: deck.jiraByKey.get(k) })))

const note = ref('')
watch(pr, (p) => (note.value = p?.note ?? ''), { immediate: true })
const saveMeta = (pinned = pr.value!.pinned) => deck.mutate(() => api.setMeta(pr.value!.id, note.value, pinned))

const depTarget = ref('')
const depKind = ref<'merge' | 'release'>('merge')
const depDirection = ref<'dependsOn' | 'blocks'>('dependsOn')
const candidates = computed(() => deck.prs.filter((p) => p.id !== pr.value?.id).map((p) => p.id))
async function addDep() {
  const [from, to] = depDirection.value === 'dependsOn' ? [pr.value!.id, depTarget.value] : [depTarget.value, pr.value!.id]
  if (await deck.mutate(() => api.addDep(from, to, depKind.value), 'Dependency added')) depTarget.value = ''
}
const removeDep = (e: DepEdge) => e.id && deck.mutate(() => api.removeDep(e.id!), 'Dependency removed')

function startResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = layout.prefs.drawerWidth
  const onMove = (e: MouseEvent) => (layout.prefs.drawerWidth = Math.min(1100, Math.max(380, startW + startX - e.clientX)))
  const onUp = () => (window.removeEventListener('mousemove', onMove), window.removeEventListener('mouseup', onUp))
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="pr"
      data-pr-drawer
      class="fixed inset-y-0 right-0 z-40 flex max-w-full flex-col border-l bg-background shadow-2xl"
      :style="{ width: layout.prefs.drawerWidth + 'px' }"
    >
      <div class="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/30" title="Drag to resize" @mousedown.prevent="startResize" />
      <header class="flex items-start gap-2 border-b p-4">
        <div class="min-w-0 flex-1">
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge :variant="ACTION_TONE[pr.action.kind]">{{ pr.action.label }}</Badge>
            <Badge variant="outline">{{ pr.state }}{{ pr.isDraft ? ' · draft' : '' }}</Badge>
            <Badge v-for="r in pr.relations" :key="r" variant="muted">{{ r.replace('_', ' ') }}</Badge>
          </div>
          <h2 class="leading-snug font-semibold">{{ pr.title }}</h2>
          <a :href="pr.url" target="_blank" class="mt-1 inline-flex items-center gap-1 font-mono text-sm text-primary hover:underline">
            {{ pr.repo }}#{{ pr.number }} <PhArrowSquareOut :size="14" />
          </a>
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="saveMeta(!pr.pinned)">
              <PhPushPin :weight="pr.pinned ? 'fill' : 'regular'" :class="{ 'text-primary': pr.pinned }" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pr.pinned ? 'Unpin' : 'Pin to top of lists' }}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" @click="deck.selectedId = null"><PhX /></Button>
      </header>

      <Tabs v-model="dv.tab" class="min-h-0 flex-1 gap-0">
        <div class="border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="conversations" :count="pr.threads.length">Conversations</TabsTrigger>
          </TabsList>
        </div>

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
          <Alert v-if="pr.action.detail"><AlertDescription>{{ pr.action.detail }}</AlertDescription></Alert>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Branch</div>
              <div class="flex items-center gap-1 font-mono text-xs"><PhGitBranch :size="14" />{{ pr.headRef }} → {{ pr.baseRef }}</div>
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
            <div v-if="pr.release" class="col-span-2">
              <div class="text-xs text-muted-foreground">Release</div>
              <div class="flex items-center gap-1">
                <PhRocketLaunch :size="14" :class="pr.release.released ? 'text-success' : 'text-muted-foreground'" />
                {{ pr.release.released ? `Released (in ${pr.release.ref})` : `Not released yet${pr.release.ref ? ` – latest is ${pr.release.ref}` : ''}` }}
                <span v-if="pr.release.error" class="text-xs text-destructive">{{ pr.release.error }}</span>
              </div>
            </div>
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
            <div v-for="{ key, issue } in jira" :key="key" class="mb-2 rounded-lg border p-3">
              <template v-if="issue">
                <div class="flex items-center gap-2">
                  <img v-if="issue.typeIconUrl" :src="issue.typeIconUrl" class="size-4" alt="" />
                  <a :href="issue.url" target="_blank" class="font-mono text-sm hover:underline">{{ issue.key }}</a>
                  <Badge :variant="jiraTone(issue.statusCategory)">{{ issue.status }}</Badge>
                  <span class="flex-1" />
                  <JiraTransition :issue-key="issue.key" />
                </div>
                <div class="mt-1 text-sm">{{ issue.summary }}</div>
                <div class="mt-1 text-xs text-muted-foreground">
                  {{ issue.assignee?.displayName ?? 'Unassigned' }}<template v-if="issue.fixVersions.length"> · fix: {{ issue.fixVersions.join(', ') }}</template>
                </div>
                <ul
                  v-if="issue.links.length"
                  class="mt-2 grid grid-cols-[max-content_max-content_minmax(0,1fr)_max-content] items-center gap-x-3 gap-y-1 text-xs"
                >
                  <li v-for="l in sortedLinks(issue.links)" :key="l.key + l.label" class="contents">
                    <span class="whitespace-nowrap text-muted-foreground">{{ l.label }}</span>
                    <a :href="jiraUrl(l.key)" target="_blank" rel="noopener" class="font-mono whitespace-nowrap underline underline-offset-2 hover:text-primary">{{ l.key }}</a>
                    <a :href="jiraUrl(l.key)" target="_blank" rel="noopener" class="truncate underline underline-offset-2 hover:text-primary" :title="l.summary">{{ l.summary }}</a>
                    <Badge :variant="jiraTone(l.statusCategory)" class="h-4 justify-self-end text-[10px]">{{ l.status }}</Badge>
                  </li>
                </ul>
              </template>
              <span v-else class="font-mono text-sm">{{ key }} <span class="text-muted-foreground">(not synced)</span></span>
            </div>
          </section>

          <Separator />

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Depends on — merge these first</h3>
            <ul class="space-y-1">
              <li v-for="e in pr.dependsOn" :key="e.to" class="flex items-center gap-2 text-sm">
                <PhCheckCircle v-if="e.satisfied" :size="16" weight="fill" class="shrink-0 text-success" />
                <PhXCircle v-else :size="16" class="shrink-0 text-warning" />
                <button class="font-mono text-primary hover:underline" @click="deck.selectedId = e.to">{{ shortId(e.to) }}</button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.to)?.title ?? (e.missing ? '(not synced yet)' : '') }}</span>
                <span class="flex-1" />
                <Badge variant="outline">{{ e.kind }}</Badge>
                <Badge variant="muted" :title="e.note ?? ''">{{ e.source }}</Badge>
                <Button v-if="e.id" variant="ghost" size="icon-xs" title="Remove" @click="removeDep(e)"><PhTrash /></Button>
              </li>
              <li v-if="!pr.dependsOn.length" class="text-sm text-muted-foreground">None</li>
            </ul>
            <h3 class="mt-4 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Blocks — waiting on this</h3>
            <ul class="space-y-1">
              <li v-for="e in pr.dependents" :key="e.from" class="flex items-center gap-2 text-sm">
                <button class="font-mono text-primary hover:underline" @click="deck.selectedId = e.from">{{ shortId(e.from) }}</button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.from)?.title }}</span>
                <span class="flex-1" />
                <Badge variant="outline">waits for {{ e.kind }}</Badge>
                <Button v-if="e.id" variant="ghost" size="icon-xs" title="Remove" @click="removeDep(e)"><PhTrash /></Button>
              </li>
              <li v-if="!pr.dependents.length" class="text-sm text-muted-foreground">None</li>
            </ul>

            <form class="mt-3 space-y-2 rounded-lg bg-muted/60 p-3" @submit.prevent="addDep">
              <div class="flex gap-2">
                <NativeSelect v-model="depDirection" size="sm">
                  <NativeSelectOption value="dependsOn">depends on</NativeSelectOption>
                  <NativeSelectOption value="blocks">blocks</NativeSelectOption>
                </NativeSelect>
                <Input v-model="depTarget" list="pr-candidates" placeholder="owner/repo#123 or PR URL" class="h-8 flex-1" required />
                <datalist id="pr-candidates"><option v-for="c in candidates" :key="c" :value="c" /></datalist>
              </div>
              <div class="flex items-center gap-2">
                <NativeSelect v-model="depKind" size="sm">
                  <NativeSelectOption value="merge">needs merge</NativeSelectOption>
                  <NativeSelectOption value="release">needs release</NativeSelectOption>
                </NativeSelect>
                <span class="flex-1 text-xs text-muted-foreground">Or write “Depends on: org/repo#12” in the PR body.</span>
                <Button size="sm" type="submit"><PhPlus /> Add</Button>
              </div>
            </form>
          </section>

          <section>
            <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">My note</h3>
            <Textarea v-model="note" rows="3" placeholder="Private note…" @blur="saveMeta()" />
          </section>
        </div>
      </ScrollArea>
      </TabsContent>
      </Tabs>
    </aside>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.18s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
