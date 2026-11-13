<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  PhCheckCircle,
  PhCircleNotch,
  PhGitMerge,
  PhLinkSimple,
  PhLockSimple,
  PhPushPin,
  PhRocketLaunch,
  PhXCircle,
} from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE, CHECK_STYLE, timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraPill from './JiraPill.vue'
import PrHover from './PrHover.vue'
import RepoName from './RepoName.vue'
import ThreadCount from './ThreadCount.vue'
import FlagStatus from './FlagStatus.vue'

/** preview: hover preview (off for rows inside side panels) */
const props = withDefaults(defineProps<{ pr: PrView; compact?: boolean; preview?: boolean; class?: HTMLAttributes['class']; /** Flags to show instead of the PR's own (e.g. a release's roll-up) */ flags?: string[]; /** Parts to leave out (PR_PROPERTIES keys) */ hide?: string[] }>(), { preview: true })
const deck = useDeck()
const check = computed(() => CHECK_STYLE[props.pr.checks.state])
const show = (part: string) => !props.hide?.includes(part)
const openDeps = computed(() => props.pr.dependsOn.filter((d) => !d.satisfied).length)
</script>

<template>
  <PrHover :pr="pr" side="bottom" :disabled="!preview">
  <div
    :data-pr-id="pr.id"
    :class="cn(
      'group flex min-w-0 cursor-pointer items-start gap-3 rounded-lg px-3 transition-colors hover:bg-accent',
      compact ? 'py-1.5' : 'py-2.5',
      deck.selectedId === pr.id && 'bg-accent ring-2 ring-primary ring-inset',
      props.class,
    )"
    @click="deck.selectedId = pr.id"
  >
    <Avatar v-if="show('avatar')" class="mt-0.5 size-7 shrink-0">
      <AvatarImage :src="pr.author.avatarUrl ?? ''" :alt="pr.author.login" />
      <AvatarFallback class="text-[10px]">{{ pr.author.login.slice(0, 2).toUpperCase() }}</AvatarFallback>
    </Avatar>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <PhPushPin v-if="pr.pinned" :size="14" weight="fill" class="shrink-0 text-primary" />
        <span class="truncate text-sm font-medium" :class="{ 'text-muted-foreground': pr.isDraft }" :title="pr.title">{{ pr.title }}</span>
      </div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <a v-if="show('repo')" :href="pr.url" target="_blank" rel="noopener" class="min-w-0 font-mono text-foreground/80 hover:underline" @click.stop>
          <RepoName :repo="pr.repo" :suffix="`#${pr.number}`" />
        </a>
        <span v-if="!compact && show('author')">{{ pr.author.login }}</span>
        <span v-if="!compact && show('updated')">updated {{ timeAgo(pr.updatedAt) }}</span>
        <template v-if="show('jira')">
          <JiraPill v-for="k in pr.jiraKeys.slice(0, 2)" :key="k" :issue-key="k" />
          <span v-if="pr.jiraKeys.length > 2">+{{ pr.jiraKeys.length - 2 }}</span>
        </template>
      </div>
      <div v-if="pr.action.detail && !compact && show('detail')" class="mt-1 truncate text-xs text-muted-foreground">{{ pr.action.detail }}</div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <template v-if="show('deps')">
      <Tooltip v-if="openDeps">
        <TooltipTrigger as-child><PhLockSimple :size="16" class="text-warning" /></TooltipTrigger>
        <TooltipContent>{{ openDeps }} unmet prerequisite(s)</TooltipContent>
      </Tooltip>
      <Tooltip v-else-if="pr.dependsOn.length || pr.dependents.length">
        <TooltipTrigger as-child><PhLinkSimple :size="16" class="text-muted-foreground" /></TooltipTrigger>
        <TooltipContent>Part of a dependency chain</TooltipContent>
      </Tooltip>
      </template>
      <ThreadCount v-if="show('threads')" :pr="pr" />
      <FlagStatus v-if="show('flags')" :keys="flags ?? pr.flags" />
      <template v-if="show('checks')">
      <Tooltip v-if="pr.state === 'OPEN'">
        <TooltipTrigger as-child>
          <span>
            <PhCheckCircle v-if="pr.checks.state === 'SUCCESS'" :size="18" weight="fill" :class="check.cls" />
            <PhXCircle v-else-if="pr.checks.state === 'FAILURE' || pr.checks.state === 'ERROR'" :size="18" weight="fill" :class="check.cls" />
            <PhCircleNotch v-else :size="18" :class="check.cls" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ check.label }}</TooltipContent>
      </Tooltip>
      <PhGitMerge v-else-if="pr.state === 'MERGED'" :size="18" class="text-merged" />
      </template>
      <PhRocketLaunch v-if="pr.release?.released && show('release')" :size="16" class="text-success" />
      <!-- Extra badges from the parent (e.g. "release · 13" in release contents) -->
      <slot name="badges" />
      <Badge v-if="show('action')" :variant="ACTION_TONE[pr.action.kind]">{{ pr.action.label }}</Badge>
    </div>
  </div>
  </PrHover>
</template>
