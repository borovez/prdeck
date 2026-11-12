<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import RepoName from './RepoName.vue'

/**
 * Text field that suggests PRs while typing: matches repo, number, title, branch and Jira keys (every word must
 * match). The value is a PR id, or whatever was typed or pasted (owner/repo#123, a PR URL).
 */
// class, required etc. go to the field (the suggestions are teleported, so there are two roots)
defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ required: true })
const props = defineProps<{
  exclude?: string
  placeholder?: string
  /** Only PRs that pass (e.g. release PRs) */
  filter?: (p: PrView) => boolean
  /** Shown but not pickable, with the reason (e.g. already a dependency) */
  disabledReason?: (p: PrView) => string | null
}>()
const deck = useDeck()
const input = ref<InstanceType<typeof Input> | null>(null)
const open = ref(false)
const active = ref(0)
const rect = ref<DOMRect | null>(null)

const terms = computed(() => model.value.toLowerCase().split(/\s+/).filter(Boolean))
const matches = computed<PrView[]>(() => {
  if (!terms.value.length) return []
  return deck.prs
    .filter((p) => p.id !== props.exclude && (!props.filter || props.filter(p)))
    .filter((p) => {
      const hay = `${p.id} ${p.repo}#${p.number} ${p.title} ${p.headRef} ${p.jiraKeys.join(' ')}`.toLowerCase()
      return terms.value.every((t) => hay.includes(t))
    })
    .sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN') || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
})
const reasonOf = (p: PrView) => props.disabledReason?.(p) ?? null
/** First pickable suggestion */
const firstFree = () => Math.max(0, matches.value.findIndex((p) => !reasonOf(p)))
watch(model, () => (active.value = firstFree()))

const el = () => (input.value?.$el ?? null) as HTMLInputElement | null
function show() {
  rect.value = el()?.getBoundingClientRect() ?? null
  open.value = true
}
function pick(p: PrView) {
  if (reasonOf(p)) return
  model.value = p.id
  open.value = false
  nextTick(() => el()?.focus())
}
function onKey(e: KeyboardEvent) {
  if (!open.value || !matches.value.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = matches.value.length
    // Skip suggestions that can't be picked
    for (let step = 0; step < n; step++) {
      active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      if (!reasonOf(matches.value[active.value])) break
    }
  } else if (e.key === 'Enter' && model.value !== matches.value[active.value]?.id && !reasonOf(matches.value[active.value])) {
    // First Enter picks the suggestion; Enter again submits the form
    e.preventDefault()
    pick(matches.value[active.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    open.value = false
  }
}
/** Below the field, or above it when there's no room */
const listStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  const above = r.bottom + 320 > window.innerHeight
  return {
    left: `${r.left}px`,
    width: `${Math.max(r.width, 420)}px`,
    ...(above ? { bottom: `${window.innerHeight - r.top + 4}px` } : { top: `${r.bottom + 4}px` }),
  }
})
</script>

<template>
  <Input
    ref="input"
    v-bind="$attrs"
    v-model="model"
    :placeholder="placeholder"
    autocomplete="off"
    role="combobox"
    :aria-expanded="open && matches.length > 0"
    @focus="show"
    @input="show"
    @blur="open = false"
    @keydown="onKey"
  />
  <Teleport to="body">
    <div
      v-if="open && matches.length"
      role="listbox"
      class="fixed z-[60] max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      :style="listStyle"
      @mousedown.prevent
    >
      <button
        v-for="(p, i) in matches"
        :key="p.id"
        type="button"
        role="option"
        :aria-selected="i === active"
        :aria-disabled="!!reasonOf(p)"
        :class="cn('flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left', reasonOf(p) ? 'cursor-not-allowed opacity-50' : i === active && 'bg-accent')"
        :title="reasonOf(p) ?? undefined"
        @mousemove="!reasonOf(p) && (active = i)"
        @click="pick(p)"
      >
        <span class="flex w-full min-w-0 items-center gap-2 text-sm">
          <span class="min-w-0 flex-1 truncate">{{ p.title }}</span>
          <Badge v-if="reasonOf(p)" variant="muted" class="shrink-0">{{ reasonOf(p) }}</Badge>
          <Badge v-else :variant="ACTION_TONE[p.action.kind]" class="shrink-0">{{ p.state === 'OPEN' ? p.action.label : p.state.toLowerCase() }}</Badge>
        </span>
        <RepoName :id="p.id" class="max-w-full font-mono text-xs text-muted-foreground" />
      </button>
    </div>
  </Teleport>
</template>
