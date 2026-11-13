<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhGitMerge, PhGitPullRequest, PhXCircle } from '@phosphor-icons/vue'
import type { PrId, PrView, ReleaseItem } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import RepoName from './RepoName.vue'

/**
 * "N PRs" chip that opens a filterable list of PRs (Linear-style "Go to linked pull requests").
 * Arrow keys move, Enter opens the PR panel. `numbered` shows each PR's position (e.g. shipping order).
 */
const props = defineProps<{
  ids: PrId[]
  placeholder?: string
  numbered?: boolean
  /** Highlighted PR (e.g. ship next) and its badge label */
  highlight?: PrId | null
  highlightLabel?: string
  /** For PRs PR Deck doesn't track (e.g. release contents): shown from this, opened on GitHub */
  fallback?: (id: PrId) => ReleaseItem | undefined
  /** Trigger shows only the count */
  compact?: boolean
}>()
/** `detail` slot: extra lines under each PR (e.g. why it is in the list) */
defineSlots<{ detail?: (p: { id: PrId }) => unknown }>()
const deck = useDeck()
const open = ref(false)
const q = ref('')
const active = ref(0)

const items = computed(() =>
  props.ids.map((id, i) => {
    const pr = deck.byId.get(id) as PrView | undefined
    return { id, n: i + 1, pr, ext: pr ? undefined : props.fallback?.(id) }
  }),
)
const shown = computed(() => {
  const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items.value
  return items.value.filter(({ id, pr, ext }) => {
    const hay = `${id} ${pr?.title ?? ext?.title ?? ''} ${pr?.headRef ?? ''} ${pr?.jiraKeys.join(' ') ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
})
watch([q, open], () => (active.value = 0))

function go(id: PrId) {
  const ext = items.value.find((i) => i.id === id)?.ext
  if (ext) window.open(ext.url, '_blank', 'noopener')
  else deck.selectedId = id
  open.value = false
  q.value = ''
}
function onKey(e: KeyboardEvent) {
  const n = shown.value.length
  if (!n) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    document.getElementById(`prlist-${active.value}`)?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    e.preventDefault()
    go(shown.value[active.value].id)
  }
}

const stateOf = (it: { pr?: PrView; ext?: ReleaseItem }) => it.pr?.state ?? it.ext?.state
const stateLabel = (pr: PrView) =>
  pr.state === 'MERGED' ? `Merged ${timeAgo(pr.mergedAt)}` : pr.state === 'CLOSED' ? `Closed ${timeAgo(pr.closedAt)}` : pr.action.label
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'nodrag nopan inline-flex shrink-0 items-center gap-1 rounded-full border bg-background text-xs font-medium hover:bg-accent data-[state=open]:bg-accent',
            compact ? 'h-5 px-1.5' : 'h-6 px-2',
          )
        "
        :title="`${ids.length} ${ids.length === 1 ? 'PR' : 'PRs'}`"
        @click="(e: MouseEvent) => (e.stopPropagation(), e.preventDefault())"
      >
        <PhGitPullRequest :size="13" class="text-primary" />
        {{ ids.length }}<template v-if="!compact"> {{ ids.length === 1 ? 'PR' : 'PRs' }}</template>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[30rem] gap-0 p-0" @keydown="onKey">
      <input
        v-model="q"
        :placeholder="placeholder ?? 'Go to pull request…'"
        class="h-10 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        autofocus
      />
      <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-96">
        <div class="p-1">
          <p v-if="!shown.length" class="px-2 py-3 text-center text-xs text-muted-foreground">No matching PRs</p>
          <button
            v-for="(it, i) in shown"
            :id="`prlist-${i}`"
            :key="it.id"
            type="button"
            :data-pr-id="it.id"
            :class="cn('flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left', i === active && 'bg-accent')"
            @mousemove="active = i"
            @click="go(it.id)"
          >
            <span
              v-if="numbered"
              :class="
                cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                  it.id === highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )
              "
            >
              {{ it.n }}
            </span>
            <PhGitMerge v-if="stateOf(it) === 'MERGED'" :size="16" class="mt-0.5 shrink-0 text-merged" />
            <PhXCircle v-else-if="stateOf(it) === 'CLOSED'" :size="16" class="mt-0.5 shrink-0 text-destructive" />
            <PhGitPullRequest v-else :size="16" :class="cn('mt-0.5 shrink-0', it.pr?.isDraft ? 'text-muted-foreground' : 'text-success')" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex min-w-0 items-center gap-1.5 text-sm">
                <span class="truncate">{{ it.pr?.title ?? it.ext?.title ?? it.id }}</span>
                <Badge v-if="it.id === highlight && highlightLabel" variant="primary" class="shrink-0">{{ highlightLabel }}</Badge>
              </span>
              <span class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <RepoName :id="it.id" class="min-w-0 truncate font-mono" />
                <template v-if="it.pr">· <span class="shrink-0">{{ stateLabel(it.pr) }}</span></template>
                <template v-else-if="it.ext">
                  · <span class="shrink-0">{{ it.ext.state === 'MERGED' ? `Merged ${timeAgo(it.ext.mergedAt)}` : it.ext.state.toLowerCase() }}</span>
                </template>
              </span>
              <slot name="detail" :id="it.id" />
            </span>
            <Avatar v-if="it.pr" class="mt-0.5 size-5 shrink-0">
              <AvatarImage :src="it.pr.author.avatarUrl ?? ''" :alt="it.pr.author.login" />
              <AvatarFallback class="text-[9px]">{{ it.pr.author.login.slice(0, 2).toUpperCase() }}</AvatarFallback>
            </Avatar>
          </button>
        </div>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
