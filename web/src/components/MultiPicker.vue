<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhCaretUpDown, PhCheck, PhCircleNotch, PhX } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface PickerOption {
  value: string
  label: string
  detail?: string
  iconUrl?: string | null
}

/** A form field picking several values from a searchable list; the picks show as removable chips */
const props = defineProps<{
  options: PickerOption[]
  placeholder?: string
  loading?: boolean
  emptyText?: string
  /** Lets you add what you typed when it isn't listed: returns the value to add, or null when it isn't valid */
  create?: (query: string) => string | null
}>()
const model = defineModel<string[]>({ required: true })

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = props.options.filter((o) => !q || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q))
  // Picked first, then the rest; then "Add …" for a typed value that isn't listed
  const typed = props.create?.(query.value.trim())
  const add = typed && !props.options.some((o) => o.value === typed) && !model.value.includes(typed) ? [{ value: typed, label: typed, detail: 'Add', iconUrl: null }] : []
  return [...list.filter((o) => model.value.includes(o.value)), ...list.filter((o) => !model.value.includes(o.value)), ...add]
})
const optionFor = (v: string) => props.options.find((o) => o.value === v)
const toggle = (v: string) => (model.value = model.value.includes(v) ? model.value.filter((x) => x !== v) : [...model.value, v])

watch(open, async (o) => {
  if (!o) return
  query.value = ''
  active.value = 0
  await nextTick()
  input.value?.focus()
})
watch(query, () => (active.value = 0))
function onKey(e: KeyboardEvent) {
  const n = rows.value.length
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % Math.max(n, 1)
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % Math.max(n, 1)
  else if (e.key === 'Enter' && rows.value[active.value]) toggle(rows.value[active.value].value)
  else return
  e.preventDefault()
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1 text-left text-sm shadow-xs transition-colors hover:bg-accent/40 dark:bg-input/30"
      >
        <div class="flex min-w-0 flex-1 flex-wrap gap-1">
          <span v-for="v in model" :key="v" class="inline-flex h-6 items-center gap-1 rounded bg-secondary pr-0.5 pl-1.5 text-xs font-medium" :title="optionFor(v)?.detail">
            <img v-if="optionFor(v)?.iconUrl" :src="optionFor(v)!.iconUrl!" alt="" class="size-3.5 rounded-sm" />
            {{ optionFor(v)?.label ?? v }}
            <span role="button" tabindex="-1" class="rounded p-0.5 hover:bg-foreground/10" :aria-label="`Remove ${v}`" @click.stop="toggle(v)"><PhX class="size-3" /></span>
          </span>
          <span v-if="!model.length" class="px-1 text-muted-foreground">{{ placeholder ?? 'Choose…' }}</span>
        </div>
        <PhCircleNotch v-if="loading" class="size-4 animate-spin text-muted-foreground" />
        <PhCaretUpDown v-else class="size-4 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-(--reka-popover-trigger-width) min-w-72 gap-0 p-0">
      <input ref="input" v-model="query" :placeholder="create ? 'Search or type to add…' : 'Search…'" class="h-9 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground" @keydown="onKey" />
      <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-72">
        <div class="p-1" role="listbox" aria-multiselectable="true">
          <div
            v-for="(o, i) in rows"
            :key="o.value"
            role="option"
            :aria-selected="model.includes(o.value)"
            :class="cn('flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm select-none', i === active && 'bg-accent')"
            @mousemove="active = i"
            @click="toggle(o.value)"
          >
            <img v-if="o.iconUrl" :src="o.iconUrl" alt="" class="size-4 rounded-sm" />
            <span v-else-if="options.some((x) => x.iconUrl)" class="size-4 shrink-0 rounded-sm bg-muted" />
            <span class="font-medium">{{ o.label }}</span>
            <span v-if="o.detail" class="min-w-0 truncate text-muted-foreground">{{ o.detail }}</span>
            <PhCheck v-if="model.includes(o.value)" class="ml-auto size-4 shrink-0 text-primary" />
          </div>
          <p v-if="!rows.length" class="px-2 py-5 text-center text-xs text-muted-foreground">{{ loading ? 'Loading…' : query ? 'No matches' : (emptyText ?? 'Nothing to choose') }}</p>
        </div>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
