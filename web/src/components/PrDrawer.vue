<script setup lang="ts">
import { useArrowNav } from '@/composables/prNav'
import { releaseStatus } from '@shared/release'
import SidePanel from './SidePanel.vue'
import { computed, ref, watch } from 'vue'
import {
  PhArrowSquareOut,
  PhCheckCircle,
  PhGitBranch,
  PhCaretDown,
  PhPlus,
  PhPushPin,
  PhRocketLaunch,
  PhTrash,
  PhXCircle,
} from '@phosphor-icons/vue'
import type { DepEdge } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { ACTION_TONE, CHECK_STYLE, jiraTone, timeAgo } from '@/utils/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraTransition from './JiraTransition.vue'
import ThreadList from './ThreadList.vue'
import JiraLinks from './JiraLinks.vue'
import RepoName from './RepoName.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
/** The action's badge tone, where alerts have a matching one */
const alertTone = computed(() => {
  const t = pr.value ? ACTION_TONE[pr.value.action.kind] : 'default'
  return t === 'destructive' || t === 'warning' || t === 'success' || t === 'info' ? t : 'default'
})
const dv = useLayout().view('drawer', {
  tab: 'details' as 'details' | 'conversations',
  // Last dependency type used in the add form
  depDirection: 'dependsOn' as 'dependsOn' | 'blocks',
  depKind: 'merge' as 'merge' | 'release',
})
useArrowNav('pr', () => deck.selectedId, (id) => (deck.selectedId = id))
const pr = computed(() => deck.selected)
const jira = computed(() => (pr.value?.jiraKeys ?? []).map((k) => ({ key: k, issue: deck.jiraByKey.get(k) })))

const note = ref('')
watch(pr, (p) => (note.value = p?.note ?? ''), { immediate: true })
const saveMeta = (pinned = pr.value!.pinned) => deck.mutate(() => api.setMeta(pr.value!.id, note.value, pinned))

const depTarget = ref('')
const candidates = computed(() => deck.prs.filter((p) => p.id !== pr.value?.id).map((p) => p.id))
async function addDep() {
  const [from, to] = dv.depDirection === 'dependsOn' ? [pr.value!.id, depTarget.value] : [depTarget.value, pr.value!.id]
  if (await deck.mutate(() => api.addDep(from, to, dv.depKind), 'Dependency added')) depTarget.value = ''
}
const removeDep = (e: DepEdge) => e.id && deck.mutate(() => api.removeDep(e.id!), 'Dependency removed')

</script>

<template>
  <SidePanel :open="!!pr" @close="deck.selectedId = null">
    <template v-if="pr" #header>
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge :variant="ACTION_TONE[pr.action.kind]">{{ pr.action.label }}</Badge>
            <Badge variant="outline">{{ pr.state }}{{ pr.isDraft ? ' · draft' : '' }}</Badge>
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
            <Button variant="ghost" size="icon-sm" @click="saveMeta(!pr.pinned)">
              <PhPushPin :weight="pr.pinned ? 'fill' : 'regular'" :class="{ 'text-primary': pr.pinned }" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ pr.pinned ? 'Unpin' : 'Pin to top of lists' }}</TooltipContent>
        </Tooltip>
    </template>

      <Tabs v-if="pr" v-model="dv.tab" class="min-h-0 flex-1 gap-0">
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
          <Alert v-if="pr.action.detail" :variant="alertTone"><AlertDescription>{{ pr.action.detail }}</AlertDescription></Alert>

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
            <div v-if="pr.release" class="col-span-2">
              <div class="text-xs text-muted-foreground">Release</div>
              <div class="flex items-start gap-1">
                <PhRocketLaunch :size="14" class="mt-0.5 shrink-0" :class="pr.release.released ? 'text-success' : 'text-muted-foreground'" />
                {{ releaseStatus(pr.release).long }}
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
<JiraLinks :links="issue.links" class="mt-2" />
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
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.to"><RepoName :id="e.to" /></button>
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
                <button class="max-w-1/2 min-w-0 shrink-0 font-mono text-primary hover:underline" @click="deck.selectedId = e.from"><RepoName :id="e.from" /></button>
                <span class="truncate text-muted-foreground">{{ deck.byId.get(e.from)?.title }}</span>
                <span class="flex-1" />
                <Badge variant="outline">waits for {{ e.kind }}</Badge>
                <Button v-if="e.id" variant="ghost" size="icon-xs" title="Remove" @click="removeDep(e)"><PhTrash /></Button>
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
              <p class="text-xs text-muted-foreground">Or write “Depends on: org/repo#12” in the PR description.</p>
            </form>
          </section>

          <section>
            <MarkdownEditor v-model="note" placeholder="Private note… (Markdown)" :height="120" state-key="pr-note" @blur="saveMeta()">
              <template #label>
                <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">My note</h3>
              </template>
            </MarkdownEditor>
          </section>
        </div>
      </ScrollArea>
      </TabsContent>
      </Tabs>
  </SidePanel>
</template>

