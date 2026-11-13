<script setup lang="ts">
import { computed } from 'vue'
import type { JiraIssueView, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import JiraTransition from './JiraTransition.vue'
import PrListPopover from './PrListPopover.vue'
import PrRow from './PrRow.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const props = defineProps<{ issueKey: string; issue: JiraIssueView | null; prs: PrView[]; dense?: boolean }>()
/** Opens the Jira panel, unless the click was on a linked PR, a link or a button (they do their own thing) */
function select(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a, button, [data-pr-id], [role="menu"]')) return
  deck.selectedJiraKey = props.issueKey
}
const deck = useDeck()
const href = computed(
  () => props.issue?.url ?? (deck.overview?.jiraBaseUrl ? `${deck.overview.jiraBaseUrl}/browse/${props.issueKey}` : undefined),
)
const prSummary = computed(() => {
  const open = props.prs.filter((p) => p.state === 'OPEN').length
  const merged = props.prs.filter((p) => p.state === 'MERGED').length
  return [open && `${open} open`, merged && `${merged} merged`].filter(Boolean).join(' · ')
})
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
</script>

<template>
  <div
    :data-jira-id="issueKey"
    :class="cn('cursor-pointer px-4 py-3 transition-colors hover:bg-accent/50', deck.selectedJiraKey === issueKey && 'bg-accent/60 ring-2 ring-primary ring-inset')"
    @click="select"
  >
    <div class="flex items-start gap-2">
      <img v-if="issue?.typeIconUrl" :src="issue.typeIconUrl" :title="issue.type" class="mt-0.5 size-4 shrink-0" alt="" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <a :href="href" target="_blank" rel="noopener" class="shrink-0 font-mono text-xs font-medium hover:underline">{{ issueKey }}</a>
          <span v-if="issue" class="truncate text-sm font-medium" :title="issue.summary">{{ issue.summary }}</span>
          <span v-else class="truncate text-sm text-muted-foreground">{{ prs[0]?.title ?? 'Not loaded from Jira' }}</span>
        </div>
        <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span v-if="issue?.assignee" class="flex items-center gap-1">
            <Avatar class="size-4">
              <AvatarImage :src="issue.assignee.avatarUrl ?? ''" :alt="issue.assignee.displayName" />
              <AvatarFallback class="text-[8px]">{{ initials(issue.assignee.displayName) }}</AvatarFallback>
            </Avatar>
            {{ issue.assignee.displayName }}
          </span>
          <span v-if="issue?.priority" class="flex items-center gap-1">
            <img v-if="issue.priorityIconUrl" :src="issue.priorityIconUrl" class="size-3.5" alt="" />{{ issue.priority }}
          </span>
          <span v-if="issue?.parent" :title="issue.parent.summary">in <span class="font-mono">{{ issue.parent.key }}</span></span>
          <span v-if="issue?.fixVersions.length">{{ issue.fixVersions.join(', ') }}</span>
          <span v-if="issue">updated {{ timeAgo(issue.updated) }}</span>
          <PrListPopover v-if="dense && prs.length" compact :ids="prs.map((p) => p.id)" :placeholder="`Go to a PR for ${issueKey}…`" />
          <span v-if="prSummary">{{ prSummary }}</span>
        </div>
      </div>
      <JiraTransition v-if="issue" :issue-key="issueKey" />
    </div>

    <div v-if="prs.length && !dense" class="mt-1 ml-1.5 border-l pl-2">
      <PrRow v-for="p in prs" :key="p.id" :pr="p" compact />
    </div>
    <div v-else-if="!dense" class="mt-1 ml-6 text-xs text-muted-foreground">No linked pull requests</div>
  </div>
</template>
