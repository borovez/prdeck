<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { PhArrowRight, PhCheckCircle, PhCircleNotch, PhCloudSlash, PhGitMerge, PhLightning, PhRocketLaunch, PhXCircle } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE, CHECK_STYLE, jiraTone } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import ThreadCount from './ThreadCount.vue'
import RepoName from './RepoName.vue'

/**
 * Compact PR card (graph nodes, board columns). `pr` is null for a PR that isn't synced yet.
 * `accent` draws a coloured stripe on the left; the default slot holds extras such as graph handles.
 */
const props = defineProps<{ id: string; pr: PrView | null; isNext?: boolean; accent?: string; selected?: boolean; class?: HTMLAttributes['class'] }>()
const deck = useDeck()
const check = computed(() => (props.pr ? CHECK_STYLE[props.pr.checks.state] : null))
const jira = computed(() => {
  const key = props.pr?.jiraKeys[0]
  if (!key) return null
  const issue = deck.jiraByKey.get(key)
  const p = issue?.parent
  // The epic's status comes with the issue, or from the epic itself when it's synced
  const synced = p ? deck.jiraByKey.get(p.key) : undefined
  const parent = p && { ...p, status: p.status ?? synced?.status, statusCategory: p.statusCategory ?? synced?.statusCategory, type: p.type ?? synced?.type }
  return { key, issue, parent }
})
</script>

<template>
  <div
    :data-pr-id="id"
    :class="cn(
      'relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow hover:shadow-md',
      !pr && 'border-dashed bg-muted/40 text-muted-foreground shadow-none',
      isNext && 'ring-2 ring-primary/40',
      (selected || deck.selectedId === id) && 'ring-2 ring-primary',
      props.class,
    )"
  >
    <span v-if="accent" class="absolute inset-y-0 left-0 w-1" :style="{ background: accent }" />
    <slot />

    <div class="space-y-1.5 py-2 pr-3" :class="accent ? 'pl-4' : 'pl-3'">
      <div class="flex items-center gap-1.5 text-xs">
        <Avatar v-if="pr" class="size-4 shrink-0">
          <AvatarImage :src="pr.author.avatarUrl ?? ''" :alt="pr.author.login" />
          <AvatarFallback class="text-[8px]">{{ pr.author.login.slice(0, 2).toUpperCase() }}</AvatarFallback>
        </Avatar>
        <RepoName :id="id" class="font-mono font-medium" />
        <span class="flex-1" />
        <Badge v-if="isNext" variant="primary" class="h-4 gap-0.5 px-1.5 text-[10px]"><PhArrowRight />Next</Badge>
        <template v-if="pr">
          <ThreadCount :pr="pr" />
          <span v-if="pr.state === 'OPEN' && check" :title="check.label" class="flex shrink-0">
            <PhCheckCircle v-if="pr.checks.state === 'SUCCESS'" :size="15" weight="fill" :class="check.cls" />
            <PhXCircle v-else-if="pr.checks.state === 'FAILURE' || pr.checks.state === 'ERROR'" :size="15" weight="fill" :class="check.cls" />
            <PhCircleNotch v-else :size="15" :class="check.cls" />
          </span>
          <PhGitMerge v-else-if="pr.state === 'MERGED'" :size="15" class="text-merged" title="Merged" />
          <PhRocketLaunch v-if="pr.release?.released" :size="14" class="text-success" title="Released" />
        </template>
      </div>

      <template v-if="pr">
        <div class="line-clamp-2 text-[13px] leading-snug font-medium" :class="{ 'text-muted-foreground': pr.isDraft }">
          {{ pr.title }}
        </div>
        <div class="text-[11px] text-muted-foreground tabular-nums">
          {{ pr.changedFiles }} {{ pr.changedFiles === 1 ? 'file' : 'files' }} ·
          <span class="text-success">+{{ pr.additions }}</span> <span class="text-destructive">−{{ pr.deletions }}</span>
        </div>
        <Badge :variant="ACTION_TONE[pr.action.kind]" class="h-5 max-w-full truncate text-[11px]">{{ pr.action.label }}</Badge>
        <!-- Jira issue and its epic/parent, with their statuses -->
        <div v-if="jira" class="space-y-1 border-t pt-1.5 text-[11px]">
          <div class="flex min-w-0 items-center gap-1" :title="jira.issue ? `${jira.key}: ${jira.issue.summary}` : jira.key">
            <img v-if="jira.issue?.typeIconUrl" :src="jira.issue.typeIconUrl" class="size-3.5" alt="" />
            <span class="shrink-0 font-mono">{{ jira.key }}</span>
            <span v-if="jira.issue" class="min-w-0 flex-1 truncate text-muted-foreground">{{ jira.issue.summary }}</span>
            <span v-else class="flex-1" />
            <Badge v-if="jira.issue" :variant="jiraTone(jira.issue.statusCategory)" class="h-4 max-w-[45%] shrink-0 truncate px-1 text-[10px]">{{ jira.issue.status }}</Badge>
          </div>
          <div v-if="jira.parent" class="flex min-w-0 items-center gap-1" :title="`${jira.parent.type ?? 'Parent'} ${jira.parent.key}: ${jira.parent.summary}`">
            <PhLightning :size="13" weight="fill" class="text-merged" />
            <span class="shrink-0 font-mono">{{ jira.parent.key }}</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ jira.parent.summary }}</span>
            <Badge v-if="jira.parent.status" :variant="jiraTone(jira.parent.statusCategory ?? '')" class="h-4 max-w-[45%] shrink-0 truncate px-1 text-[10px]">{{ jira.parent.status }}</Badge>
          </div>
        </div>
      </template>
      <div v-else class="flex items-center gap-1.5 text-xs"><PhCloudSlash :size="14" />Not synced yet</div>
    </div>
  </div>
</template>
