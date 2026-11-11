<script setup lang="ts">
import type { SlackItem } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { fullDate, timeAgo } from '@/utils/format'
import { KIND } from '@/utils/slack'
import { cn } from '@/lib/utils'
import SlackActions from './SlackActions.vue'
import JiraPill from './JiraPill.vue'
import SlackText from './SlackText.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

/** Slack inbox row; clicking it opens the message in the side panel. */
defineProps<{ item: SlackItem }>()
const deck = useDeck()
</script>

<template>
  <div
    :data-slack-id="item.id"
    :class="cn(
      'group flex cursor-pointer gap-3 rounded-lg px-3 py-2.5 hover:bg-accent',
      item.status !== 'new' && 'opacity-60',
      deck.selectedSlackId === item.id && 'bg-accent ring-2 ring-primary ring-inset',
    )"
    @click="deck.selectedSlackId = item.id"
  >
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
        <Badge v-if="item.kind === 'saved'" variant="primary" class="h-4 text-[10px]">saved</Badge>
        <Badge v-if="item.kind === 'todo'" variant="primary" class="h-4 text-[10px]">todo</Badge>
        <Badge v-if="item.awaitingReply && item.status === 'new'" variant="warning" class="h-4 text-[10px]">awaiting reply</Badge>
        <Badge v-if="item.threadTs" variant="muted" class="h-4 text-[10px]">in thread</Badge>
        <JiraPill v-if="item.jiraKey" :issue-key="item.jiraKey" />
      </div>
      <SlackText :text="item.text" :rich="item.rich" class="mt-0.5 line-clamp-2 text-sm" />
    </div>
    <time
      :datetime="item.postedAt"
      :title="fullDate(item.postedAt)"
      class="w-16 shrink-0 pt-0.5 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
    >
      {{ timeAgo(item.postedAt) }}
    </time>
    <SlackActions :item="item" class="opacity-60 transition-opacity group-hover:opacity-100" />
  </div>
</template>
