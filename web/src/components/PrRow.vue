<script setup lang="ts">
import { computed } from 'vue'
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
import RepoName from './RepoName.vue'
import ThreadCount from './ThreadCount.vue'

const props = defineProps<{ pr: PrView; compact?: boolean }>()
const deck = useDeck()
const check = computed(() => CHECK_STYLE[props.pr.checks.state])
const openDeps = computed(() => props.pr.dependsOn.filter((d) => !d.satisfied).length)
</script>

<template>
  <div
    :data-pr-id="pr.id"
    :class="cn(
      'group flex cursor-pointer items-start gap-3 rounded-lg px-3 transition-colors hover:bg-accent',
      compact ? 'py-1.5' : 'py-2.5',
      deck.selectedId === pr.id && 'bg-accent',
    )"
    @click="deck.selectedId = pr.id"
  >
    <Avatar class="mt-0.5 size-7 shrink-0">
      <AvatarImage :src="pr.author.avatarUrl ?? ''" :alt="pr.author.login" />
      <AvatarFallback class="text-[10px]">{{ pr.author.login.slice(0, 2).toUpperCase() }}</AvatarFallback>
    </Avatar>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <PhPushPin v-if="pr.pinned" :size="14" weight="fill" class="shrink-0 text-primary" />
        <span class="truncate text-sm font-medium" :class="{ 'text-muted-foreground': pr.isDraft }">{{ pr.title }}</span>
      </div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <a :href="pr.url" target="_blank" rel="noopener" class="min-w-0 font-mono text-foreground/80 hover:underline" @click.stop>
          <RepoName :repo="pr.repo" :suffix="`#${pr.number}`" />
        </a>
        <span v-if="!compact">{{ pr.author.login }}</span>
        <span v-if="!compact">updated {{ timeAgo(pr.updatedAt) }}</span>
        <JiraPill v-for="k in pr.jiraKeys.slice(0, 2)" :key="k" :issue-key="k" />
        <span v-if="pr.jiraKeys.length > 2">+{{ pr.jiraKeys.length - 2 }}</span>
      </div>
      <div v-if="pr.action.detail && !compact" class="mt-1 truncate text-xs text-muted-foreground">{{ pr.action.detail }}</div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <Tooltip v-if="openDeps">
        <TooltipTrigger as-child><PhLockSimple :size="16" class="text-warning" /></TooltipTrigger>
        <TooltipContent>{{ openDeps }} unmet prerequisite(s)</TooltipContent>
      </Tooltip>
      <Tooltip v-else-if="pr.dependsOn.length || pr.dependents.length">
        <TooltipTrigger as-child><PhLinkSimple :size="16" class="text-muted-foreground" /></TooltipTrigger>
        <TooltipContent>Part of a dependency chain</TooltipContent>
      </Tooltip>
      <ThreadCount :pr="pr" />
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
      <PhRocketLaunch v-if="pr.release?.released" :size="16" class="text-success" />
      <Badge :variant="ACTION_TONE[pr.action.kind]">{{ pr.action.label }}</Badge>
    </div>
  </div>
</template>
