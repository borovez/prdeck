<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhArrowSquareOut, PhChatCircle, PhGraph, PhPencilSimple, PhRocketLaunch, PhArrowsClockwise, PhSquareSplitHorizontal, PhRobot } from '@phosphor-icons/vue'
import type { JiraIssueDetail } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useArrowNav } from '@/composables/prNav'
import { useReleaseNav } from '@/composables/releaseNav'
import { followBeside, openBeside } from '@/composables/besideWindow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { jiraTone, timeAgo, fullDate } from '@/utils/format'
import AdfView from './AdfView.vue'
import JiraLinks from './JiraLinks.vue'
import AgentPromptDialog from './AgentPromptDialog.vue'
import JiraTransition from './JiraTransition.vue'
import PrRow from './PrRow.vue'
import FlagList from './FlagList.vue'
import SidePanel from './SidePanel.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

/** Side panel for a Jira issue: details, linked PRs and issues, description and latest comments. */
const deck = useDeck()
/** The copy-paste prompt for an AI agent */
const promptOpen = ref(false)
const key = computed(() => deck.selectedJiraKey)
const nav = useReleaseNav()
const releaseId = computed(() => (key.value ? nav.releaseForIssue(key.value) : null))
const issue = computed(() => (key.value ? (deck.jiraByKey.get(key.value) ?? null) : null))
const prs = computed(() => (key.value ? deck.prs.filter((p) => p.jiraKeys.includes(key.value!)) : []))
/** Flags named by this issue's PRs */
const flags = computed(() => [...new Set(prs.value.flatMap((p) => p.flags))])
const url = computed(() => issue.value?.url ?? (deck.overview?.jiraBaseUrl && key.value ? `${deck.overview.jiraBaseUrl}/browse/${key.value}` : undefined))
watch(url, (u) => u && followBeside(u))
useArrowNav('jira', () => deck.selectedJiraKey, (k) => (deck.selectedJiraKey = k))

/** Description and comments, fetched once per issue for this page session */
const cache = new Map<string, Promise<JiraIssueDetail>>()
const detail = ref<JiraIssueDetail | null>(null)
const error = ref('')
async function loadDetail(k: string | null, force = false) {
  if (!force) detail.value = null
  error.value = ''
  if (!k || !deck.overview?.configured.jira) return
  if (force) cache.delete(k)
  if (!cache.has(k)) cache.set(k, api.jiraDetail(k))
  try {
    const d = await cache.get(k)!
    if (key.value === k) detail.value = d
  } catch (e) {
    cache.delete(k)
    if (key.value === k) error.value = (e as Error).message
  }
}
watch(key, (k) => loadDetail(k), { immediate: true })

/** Reload: the issue's fields (into the cache, so it shows even when the sync didn't fetch it) and its description and comments */
const reloading = ref(false)
async function reload() {
  const k = key.value
  if (!k || reloading.value) return
  reloading.value = true
  await Promise.all([deck.mutate(() => api.jiraRefresh(k)), loadDetail(k, true)])
  reloading.value = false
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
const details = computed(() => {
  const i = issue.value
  if (!i) return []
  return [
    { label: 'Type', value: i.type },
    { label: 'Priority', value: i.priority ?? 'None' },
    { label: 'Parent', value: i.parent ? `${i.parent.key} · ${i.parent.summary}` : '—', open: i.parent?.key },
    { label: 'Fix version', value: i.fixVersions.join(', ') || '—' },
    { label: 'Labels', value: i.labels.join(', ') || '—' },
  ]
})
</script>

<template>
  <SidePanel :open="!!key" @close="deck.selectedJiraKey = null">
    <template v-if="key" #header>
      <div class="flex flex-wrap items-center gap-1.5">
        <img v-if="issue?.typeIconUrl" :src="issue.typeIconUrl" :title="issue.type" class="size-4" alt="" />
        <a
          v-if="url"
          :href="url"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-1 font-mono text-sm font-medium text-primary hover:underline"
          title="Open in Jira"
        >
          {{ key }}<PhArrowSquareOut :size="14" class="shrink-0" />
        </a>
        <span v-else class="font-mono text-sm font-medium">{{ key }}</span>
        <Badge v-if="issue" :variant="jiraTone(issue.statusCategory)">{{ issue.status }}</Badge>
        <span class="flex-1" />
        <Button variant="outline" size="sm" class="h-7" title="Copy a prompt for an AI agent to implement this issue" @click="promptOpen = true">
          <PhRobot /> Prompt
        </Button>
        <Button v-if="deck.overview?.configured.jira" variant="outline" size="sm" class="h-7" @click="deck.composer = { mode: 'edit', key: key! }">
          <PhPencilSimple /> Edit
        </Button>
      </div>
      <h2 class="mt-1.5 leading-snug font-semibold">{{ issue?.summary ?? 'Not loaded from Jira' }}</h2>
    </template>

    <ScrollArea v-if="key" class="min-h-0 flex-1">
      <div class="space-y-5 p-4">
        <div v-if="issue" class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <div class="text-xs text-muted-foreground">Assignee</div>
            <div v-if="issue.assignee" class="flex items-center gap-1.5">
              <Avatar class="size-5">
                <AvatarImage :src="issue.assignee.avatarUrl ?? ''" :alt="issue.assignee.displayName" />
                <AvatarFallback class="text-[9px]">{{ initials(issue.assignee.displayName) }}</AvatarFallback>
              </Avatar>
              {{ issue.assignee.displayName }}
            </div>
            <div v-else class="text-muted-foreground">Unassigned</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">Updated</div>
            <div :title="fullDate(issue.updated)">{{ timeAgo(issue.updated) }}</div>
          </div>
          <div v-for="d in details" :key="d.label" class="min-w-0">
            <div class="text-xs text-muted-foreground">{{ d.label }}</div>
            <button
              v-if="d.open"
              type="button"
              class="block max-w-full truncate text-left text-primary hover:underline"
              :title="`Open ${d.value}`"
              @click="deck.selectedJiraKey = d.open"
            >
              {{ d.value }}
            </button>
            <div v-else class="truncate" :title="d.value">{{ d.value }}</div>
          </div>
        </div>

        <section>
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pull requests</h3>
          <div v-if="prs.length" class="-mx-3"><PrRow v-for="p in prs" :key="p.id" :pr="p" compact :preview="false" /></div>
          <p v-else class="text-sm text-muted-foreground">No linked pull requests</p>
        </section>

        <section v-if="flags.length">
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Feature flags</h3>
          <FlagList :keys="flags" />
        </section>

        <section v-if="issue?.links.length">
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Linked issues</h3>
          <JiraLinks :links="issue.links" />
        </section>

        <Separator />

        <section>
          <h3 class="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Description</h3>
          <p v-if="!deck.overview?.configured.jira" class="text-sm text-muted-foreground">Connect Jira to see the description and comments.</p>
          <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
          <template v-else-if="detail">
            <AdfView v-if="detail.description?.content?.length" :doc="detail.description" />
            <p v-else class="text-sm text-muted-foreground">No description</p>
          </template>
          <div v-else class="space-y-2"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" /></div>
        </section>

        <section v-if="detail && detail.comments.length">
          <h3 class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <PhChatCircle :size="14" /> Comments
            <span class="font-normal normal-case">{{ detail.commentTotal > detail.comments.length ? `latest ${detail.comments.length} of ${detail.commentTotal}` : detail.comments.length }}</span>
          </h3>
          <div class="space-y-3">
            <div v-for="c in detail.comments" :key="c.id" class="flex gap-3 rounded-lg border p-3">
              <Avatar class="size-7 shrink-0">
                <AvatarImage :src="c.avatarUrl ?? ''" :alt="c.author" />
                <AvatarFallback class="text-[10px]">{{ initials(c.author) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0 flex-1">
                <div class="text-xs"><span class="font-semibold">{{ c.author }}</span> <span class="text-muted-foreground" :title="fullDate(c.created)">{{ timeAgo(c.created) }}</span></div>
                <AdfView :doc="c.body" class="[&>p:first-child]:mt-0.5" />
              </div>
            </div>
          </div>
          <a v-if="detail.commentTotal > detail.comments.length && url" :href="url" target="_blank" rel="noopener" class="mt-2 inline-block text-xs text-primary hover:underline">
            All {{ detail.commentTotal }} comments in Jira
          </a>
        </section>
      </div>
    </ScrollArea>
    <!-- Pinned actions, like the Slack panel -->
    <!-- To the release that ships this issue; Jira beside this window -->
    <template v-if="key && (releaseId || url || deck.overview?.configured.jira)" #actions>
      <template v-if="releaseId">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Open on the Releases page" @click="nav.openReleases(releaseId!, deck.byId.get(releaseId!)?.flow === 'hotfix' ? 'hotfixes' : 'releases')"><PhRocketLaunch /></Button>
        </TooltipTrigger>
        <TooltipContent>Open the release that ships this issue</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Show in the release graph" @click="nav.openGraph(releaseId!, releaseId!.split('#')[0])"><PhGraph /></Button>
        </TooltipTrigger>
        <TooltipContent>Show in the release graph</TooltipContent>
      </Tooltip>
      </template>
      <Tooltip v-if="deck.overview?.configured.jira">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Reload from Jira" :disabled="reloading" @click="reload">
            <PhArrowsClockwise :class="{ 'animate-spin': reloading }" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload from Jira</TooltipContent>
      </Tooltip>
      <Tooltip v-if="url">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Open beside" @click="openBeside(url!)"><PhSquareSplitHorizontal /></Button>
        </TooltipTrigger>
        <TooltipContent>Open in Jira in a window beside this one (follows the issue you select)</TooltipContent>
      </Tooltip>
    </template>

    <template v-if="key && (issue || url)" #footer>
      <Button v-if="url" variant="outline" size="sm" as="a" :href="url" target="_blank" rel="noopener"><PhArrowSquareOut /> Open in Jira</Button>
      <span class="flex-1" />
      <JiraTransition v-if="issue" :issue-key="key" prominent />
    </template>
    <AgentPromptDialog v-if="key" v-model:open="promptOpen" :issue-key="key" />
  </SidePanel>
</template>
