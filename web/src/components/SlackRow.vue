<script setup lang="ts">
import { ref } from 'vue'
import {
  PhArrowCounterClockwise,
  PhArrowSquareOut,
  PhAt,
  PhBookmarkSimple,
  PhChatsCircle,
  PhCheck,
  PhCheckSquare,
  PhKanban,
  PhUsers,
  PhX,
} from '@phosphor-icons/vue'
import type { SlackItem } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JiraPill from './JiraPill.vue'

const props = defineProps<{ item: SlackItem }>()
const emit = defineEmits<{ jira: [item: SlackItem] }>()
const deck = useDeck()
const expanded = ref(false)
const status = (s: SlackItem['status']) => deck.mutate(() => api.slackStatus(props.item.id, s))
const KIND = {
  mention: { icon: PhAt, label: 'Mention' },
  dm: { icon: PhChatsCircle, label: 'Direct message' },
  group: { icon: PhUsers, label: 'Group DM' },
  saved: { icon: PhBookmarkSimple, label: 'Saved for later' },
  todo: { icon: PhCheckSquare, label: 'Marked todo' },
} as const
</script>

<template>
  <div :class="cn('group flex gap-3 rounded-lg px-3 py-2.5 hover:bg-accent', item.status !== 'new' && 'opacity-60')">
    <Avatar class="size-7 shrink-0">
      <AvatarImage v-if="item.userAvatar" :src="item.userAvatar" :alt="item.userName" />
      <AvatarFallback class="text-[10px]">{{ item.userName.slice(0, 2).toUpperCase() }}</AvatarFallback>
    </Avatar>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span class="font-semibold">{{ item.userName }}</span>
        <span class="inline-flex items-center gap-1 text-muted-foreground">
          <component :is="KIND[item.kind].icon" :size="12" />{{ item.channelName }}
        </span>
        <span class="text-muted-foreground">{{ timeAgo(item.postedAt) }}</span>
        <Badge v-if="item.kind === 'saved'" variant="primary" class="h-4 text-[10px]">saved</Badge>
        <Badge v-if="item.kind === 'todo'" variant="primary" class="h-4 text-[10px]">todo</Badge>
        <Badge v-if="item.awaitingReply && item.status === 'new'" variant="warning" class="h-4 text-[10px]">awaiting reply</Badge>
        <Badge v-if="item.threadTs" variant="muted" class="h-4 text-[10px]">in thread</Badge>
        <JiraPill v-if="item.jiraKey" :issue-key="item.jiraKey" />
      </div>
      <p :class="cn('mt-0.5 cursor-pointer text-sm break-words whitespace-pre-line', !expanded && 'line-clamp-2')" @click="expanded = !expanded">{{ item.text }}</p>
    </div>
    <div class="flex shrink-0 items-start gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
      <Tooltip v-if="item.permalink">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-xs" as="a" :href="item.permalink" target="_blank"><PhArrowSquareOut /></Button>
        </TooltipTrigger>
        <TooltipContent>Open in Slack</TooltipContent>
      </Tooltip>
      <Tooltip v-if="!item.jiraKey">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-xs" @click="emit('jira', item)"><PhKanban /></Button>
        </TooltipTrigger>
        <TooltipContent>Create Jira task with Claude</TooltipContent>
      </Tooltip>
      <template v-if="item.status === 'new'">
        <Tooltip>
          <TooltipTrigger as-child><Button variant="ghost" size="icon-xs" @click="status('done')"><PhCheck /></Button></TooltipTrigger>
          <TooltipContent>Done</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child><Button variant="ghost" size="icon-xs" @click="status('dismissed')"><PhX /></Button></TooltipTrigger>
          <TooltipContent>Dismiss</TooltipContent>
        </Tooltip>
      </template>
      <Tooltip v-else>
        <TooltipTrigger as-child><Button variant="ghost" size="icon-xs" @click="status('new')"><PhArrowCounterClockwise /></Button></TooltipTrigger>
        <TooltipContent>Back to inbox</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
