<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PhArrowsClockwise, PhCheckCircle, PhCircle, PhCircleNotch, PhMinusCircle, PhWarningCircle } from '@phosphor-icons/vue'
import type { SyncStep } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

/** The header's Sync button; hovering shows each sync stage: done, running, queued, skipped or failed */
defineProps<{ disabled?: boolean }>()

const deck = useDeck()
const status = computed(() => deck.syncStatus ?? deck.overview?.sync ?? null)
const steps = computed(() => status.value?.steps ?? [])
const running = computed(() => deck.syncRunning)
const doneCount = computed(() => steps.value.filter((s) => s.status === 'done' || s.status === 'error' || s.status === 'skipped').length)

// Ticks the running step's elapsed time
const now = ref(Date.now())
let tick: number | undefined
watch(
  running,
  (r) => {
    clearInterval(tick)
    if (r) tick = window.setInterval(() => (now.value = Date.now()), 250)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(tick))

function seconds(ms: number) {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

function timing(s: SyncStep) {
  if (s.status === 'running' && s.startedAt) return seconds(now.value - Date.parse(s.startedAt))
  if (s.startedAt && s.finishedAt) return seconds(Date.parse(s.finishedAt) - Date.parse(s.startedAt))
  if (s.status === 'queued') return 'Queued'
  if (s.status === 'skipped') return 'Skipped'
  return ''
}

const ICON = {
  done: { icon: PhCheckCircle, class: 'text-success', weight: 'fill' },
  running: { icon: PhCircleNotch, class: 'animate-spin text-primary', weight: 'bold' },
  queued: { icon: PhCircle, class: 'text-muted-foreground/60', weight: 'regular' },
  skipped: { icon: PhMinusCircle, class: 'text-muted-foreground/60', weight: 'regular' },
  error: { icon: PhWarningCircle, class: 'text-destructive', weight: 'fill' },
} as const
</script>

<template>
  <HoverCard :open-delay="150" :close-delay="100">
    <HoverCardTrigger as-child>
      <Button size="sm" variant="outline" :disabled="disabled" :aria-disabled="running" :aria-busy="running" @click="!running && deck.sync()">
        <PhArrowsClockwise :class="{ 'animate-spin': running }" />
        <span class="max-sm:hidden">{{ running ? 'Syncing' : 'Sync' }}</span>
        <Badge v-if="running && steps.length" variant="primary" class="h-4.5 px-1.5 text-[11px] tabular-nums">
          {{ Math.min(doneCount + 1, steps.length) }}/{{ steps.length }}
        </Badge>
      </Button>
    </HoverCardTrigger>
    <HoverCardContent align="end" class="w-80 p-0">
      <div class="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <span class="text-sm font-medium">{{ running ? 'Syncing' : 'Last sync' }}</span>
        <span class="text-xs text-muted-foreground">
          <template v-if="running">{{ doneCount }} of {{ steps.length }} done</template>
          <template v-else-if="status?.lastFinishedAt">
            {{ timeAgo(status.lastFinishedAt) }}<template v-if="status.lastDurationMs"> · {{ seconds(status.lastDurationMs) }}</template>
          </template>
          <template v-else>Never</template>
        </span>
      </div>
      <ul v-if="steps.length" class="py-1">
        <li v-for="s in steps" :key="s.id" class="flex items-start gap-2 px-3 py-1.5" :class="{ 'bg-accent/50': s.status === 'running' }">
          <component :is="ICON[s.status].icon" :weight="ICON[s.status].weight" class="mt-0.5 size-4 shrink-0" :class="ICON[s.status].class" />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm" :class="{ 'text-muted-foreground': s.status === 'queued' || s.status === 'skipped' }">{{ s.label }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ timing(s) }}</span>
            </div>
            <p
              v-if="s.detail"
              class="truncate text-xs"
              :class="s.status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
              :title="s.detail"
            >
              {{ s.detail }}
            </p>
          </div>
        </li>
      </ul>
      <p v-else class="px-3 py-3 text-xs text-muted-foreground">Stage details show after the next sync.</p>
    </HoverCardContent>
  </HoverCard>
</template>
