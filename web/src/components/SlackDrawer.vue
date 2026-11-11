<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhArrowSquareOut } from '@phosphor-icons/vue'
import type { SlackMessage } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useArrowNav } from '@/composables/prNav'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import SidePanel from './SidePanel.vue'
import SlackActions from './SlackActions.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { KIND } from '@/utils/slack'

/** Side panel for a Slack inbox item: the message with the two before and after it. */
const deck = useDeck()
const item = computed(() => deck.selectedSlack)
useArrowNav('slack', () => deck.selectedSlackId, (id) => (deck.selectedSlackId = id))

/** Fetched once per item for this page session */
const cache = new Map<string, Promise<SlackMessage[]>>()
const messages = ref<SlackMessage[] | null>(null)
const error = ref('')
watch(
  () => item.value?.id,
  async (id) => {
    messages.value = null
    error.value = ''
    if (!id) return
    if (!cache.has(id)) cache.set(id, api.slackAround(id))
    try {
      const list = await cache.get(id)!
      if (item.value?.id === id) messages.value = list
    } catch (e) {
      cache.delete(id)
      if (item.value?.id === id) error.value = (e as Error).message
    }
  },
  { immediate: true },
)
</script>

<template>
  <SidePanel :open="!!item" @close="deck.selectedSlackId = null">
    <template v-if="item" #header>
      <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="muted" class="gap-1"><component :is="KIND[item.kind].icon" />{{ KIND[item.kind].label }}</Badge>
        <span>{{ item.channelName }}</span>
        <Badge v-if="item.threadTs" variant="muted">in thread</Badge>
      </div>
      <h2 class="mt-1.5 font-semibold">{{ item.userName }}</h2>
      <a v-if="item.permalink" :href="item.permalink" target="_blank" rel="noopener" class="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">
        Open in Slack <PhArrowSquareOut :size="14" />
      </a>
    </template>

    <ScrollArea v-if="item" class="min-h-0 flex-1">
      <div class="space-y-2 p-4">
        <p class="text-xs text-muted-foreground">{{ item.threadTs ? 'In the thread' : 'In the conversation' }}</p>
        <template v-if="messages">
          <div
            v-for="m in messages"
            :key="m.ts"
            :class="cn('flex gap-3 rounded-lg border p-3', m.isTarget ? 'border-primary bg-primary/10' : 'border-transparent')"
          >
            <Avatar class="size-7 shrink-0">
              <AvatarImage v-if="m.userAvatar" :src="m.userAvatar" :alt="m.userName" />
              <AvatarFallback class="text-[10px]">{{ m.userName.slice(0, 2).toUpperCase() }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-xs">
                <span class="font-semibold">{{ m.userName }}</span>
                <span class="text-muted-foreground" :title="m.postedAt">{{ timeAgo(m.postedAt) }}</span>
                <Badge v-if="m.isTarget" variant="primary" class="h-4 text-[10px]">{{ KIND[item.kind].label }}</Badge>
              </div>
              <p class="mt-0.5 text-sm break-words whitespace-pre-line">{{ m.text }}</p>
            </div>
          </div>
        </template>
        <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
        <template v-else>
          <div v-for="i in 3" :key="i" class="flex gap-3 p-3">
            <Skeleton class="size-7 rounded-full" />
            <div class="flex-1 space-y-2"><Skeleton class="h-3 w-32" /><Skeleton class="h-3 w-full" /></div>
          </div>
        </template>
      </div>
    </ScrollArea>
    <template v-if="item" #footer>
      <SlackActions :item="item" labelled />
    </template>
  </SidePanel>
</template>
