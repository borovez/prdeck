<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhArrowDown, PhArrowSquareOut, PhArrowUp, PhCircleNotch } from '@phosphor-icons/vue'
import type { SlackContext } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useArrowNav } from '@/composables/prNav'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import SidePanel from './SidePanel.vue'
import SlackText from './SlackText.vue'
import SlackActions from './SlackActions.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { KIND } from '@/utils/slack'

/** Side panel for a Slack inbox item: the message with the two before and after it. */
const deck = useDeck()
const item = computed(() => deck.selectedSlack)
useArrowNav('slack', () => deck.selectedSlackId, (id) => (deck.selectedSlackId = id))

/** Messages around the item; "Load more" widens the window by STEP on either side */
const STEP = 5
const ctx = ref<SlackContext | null>(null)
const counts = ref({ before: 2, after: 2 })
const loading = ref<'' | 'before' | 'after'>('')
const error = ref('')
/** Fetched once per item and window for this page session */
const cache = new Map<string, Promise<SlackContext>>()

/** The list element; its scroll container is the ScrollArea viewport around it */
const list = ref<HTMLElement | null>(null)
const viewport = () => list.value?.closest<HTMLElement>('[data-slot=scroll-area-viewport]') ?? null

async function load(id: string, opts: { reveal?: boolean } = {}) {
  const { before, after } = counts.value
  const key = `${id}|${before}|${after}`
  if (!cache.has(key)) cache.set(key, api.slackAround(id, before, after))
  try {
    const c = await cache.get(key)!
    if (item.value?.id !== id) return
    ctx.value = c
    if (opts.reveal) {
      await nextTick()
      list.value?.querySelector('[data-target]')?.scrollIntoView({ block: 'center' })
    }
  } catch (e) {
    cache.delete(key)
    if (item.value?.id === id) error.value = (e as Error).message
  }
}
watch(
  () => item.value?.id,
  (id) => {
    ctx.value = null
    error.value = ''
    counts.value = { before: 2, after: 2 }
    if (id) load(id, { reveal: true })
  },
  { immediate: true },
)
/** Keeps what's shown while the wider window loads */
async function more(side: 'before' | 'after') {
  if (!item.value || loading.value) return
  loading.value = side
  counts.value = { ...counts.value, [side]: counts.value[side] + STEP }
  // Messages added above would push the view down: keep the reader where they were
  const vp = viewport()
  const fromBottom = vp ? vp.scrollHeight - vp.scrollTop : 0
  await load(item.value.id)
  if (side === 'before' && vp) {
    await nextTick()
    vp.scrollTop = vp.scrollHeight - fromBottom
  }
  loading.value = ''
}
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
        Open in Slack <PhArrowSquareOut :size="14" class="shrink-0" />
      </a>
    </template>

    <ScrollArea v-if="item" class="min-h-0 flex-1">
      <div ref="list" class="space-y-2 p-4">
        <p class="text-xs text-muted-foreground">{{ item.threadTs ? 'In the thread' : 'In the conversation' }}</p>
        <template v-if="ctx">
          <!-- More conversation above: faded placeholder rows and a button to load them -->
          <div v-if="ctx.hasBefore" class="space-y-1">
            <div class="pointer-events-none space-y-1 [mask-image:linear-gradient(to_bottom,transparent,black)]" aria-hidden="true">
              <div v-for="i in 2" :key="i" class="flex gap-3 px-3 py-2">
                <Skeleton class="size-7 rounded-full" />
                <div class="flex-1 space-y-2"><Skeleton class="h-3 w-28" /><Skeleton class="h-3" :class="i === 1 ? 'w-3/5' : 'w-4/5'" /></div>
              </div>
            </div>
            <Button variant="ghost" size="sm" class="w-full text-muted-foreground" :disabled="!!loading" @click="more('before')">
              <PhCircleNotch v-if="loading === 'before'" class="animate-spin" /><PhArrowUp v-else /> Load 5 earlier messages
            </Button>
          </div>
          <div
            v-for="m in ctx.messages"
            :key="m.ts"
            :data-target="m.isTarget || undefined"
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
              <SlackText :text="m.text" :rich="m.rich" class="mt-0.5 text-sm" />
            </div>
          </div>
          <!-- More conversation below -->
          <div v-if="ctx.hasAfter" class="space-y-1">
            <Button variant="ghost" size="sm" class="w-full text-muted-foreground" :disabled="!!loading" @click="more('after')">
              <PhCircleNotch v-if="loading === 'after'" class="animate-spin" /><PhArrowDown v-else /> Load 5 later messages
            </Button>
            <div class="pointer-events-none space-y-1 [mask-image:linear-gradient(to_top,transparent,black)]" aria-hidden="true">
              <div v-for="i in 2" :key="i" class="flex gap-3 px-3 py-2">
                <Skeleton class="size-7 rounded-full" />
                <div class="flex-1 space-y-2"><Skeleton class="h-3 w-24" /><Skeleton class="h-3" :class="i === 1 ? 'w-4/5' : 'w-1/2'" /></div>
              </div>
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
