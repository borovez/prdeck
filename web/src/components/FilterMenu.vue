<script setup lang="ts">
import { ScrollArea } from '@/components/ui/scroll-area'
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { PhCaretLeft, PhCaretRight, PhCheck, PhFunnelSimple, PhX } from '@phosphor-icons/vue'
import { onKeyStroke } from '@vueuse/core'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface FilterOption {
  value: string
  label: string
  icon?: Component
  /** Tailwind classes for the option's icon (a status colour) */
  iconClass?: string
  /** Image instead of an icon (avatars) */
  avatar?: string
  /** How many items match this option with the other filters applied */
  count?: number
  /** Muted text after the label, also searched (a repo's org) */
  hint?: string
}
export interface FilterField {
  key: string
  label: string
  icon: Component
  options: FilterOption[]
  /** Fields with a different group number get a separator between them */
  group?: number
  mono?: boolean
}
export type Filters = Record<string, string[]>

/**
 * Linear-style filter menu: search across fields and values, open a field to tick several values.
 * Press F to open. `ActiveFilters` shows the chips; `openOn(key)` reopens the menu on one field.
 */
const props = defineProps<{ fields: FilterField[] }>()
const model = defineModel<Filters>({ required: true })

const open = ref(false)
const query = ref('')
const field = ref<FilterField | null>(null)
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const selected = (key: string) => model.value[key] ?? []
const activeCount = computed(() => props.fields.reduce((n, f) => n + selected(f.key).length, 0))

function toggle(key: string, value: string) {
  const cur = selected(key)
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  const copy = { ...model.value }
  if (next.length) copy[key] = next
  else delete copy[key]
  model.value = copy
}
function clear(key?: string) {
  if (!key) return (model.value = {})
  const copy = { ...model.value }
  delete copy[key]
  model.value = copy
}

type Row =
  | { kind: 'field'; field: FilterField }
  | { kind: 'option'; field: FilterField; option: FilterOption; showField: boolean }
  | { kind: 'back'; field: FilterField }

const rows = computed<Row[]>(() => {
  const q = query.value.trim().toLowerCase()
  const match = (s: string) => s.toLowerCase().includes(q)
  const matchOption = (o: FilterOption) => match(o.label) || (!!o.hint && match(o.hint))
  if (field.value) {
    const f = field.value
    return [
      { kind: 'back', field: f },
      ...f.options.filter((o) => !q || matchOption(o)).map((o) => ({ kind: 'option' as const, field: f, option: o, showField: false })),
    ]
  }
  if (!q) return props.fields.map((f) => ({ kind: 'field' as const, field: f }))
  // Searching from the top: matching fields, then matching values from every field
  return [
    ...props.fields.filter((f) => match(f.label)).map((f) => ({ kind: 'field' as const, field: f })),
    ...props.fields.flatMap((f) =>
      f.options.filter(matchOption).slice(0, 8).map((o) => ({ kind: 'option' as const, field: f, option: o, showField: true })),
    ),
  ]
})

function enter(f: FilterField) {
  field.value = f
  query.value = ''
  active.value = 1
  input.value?.focus()
}
function back() {
  const from = field.value
  field.value = null
  query.value = ''
  active.value = Math.max(0, props.fields.findIndex((f) => f === from))
  input.value?.focus()
}
function activate(r: Row) {
  if (r.kind === 'field') enter(r.field)
  else if (r.kind === 'back') back()
  else toggle(r.field.key, r.option.value)
}

watch([query, field], () => {
  if (!field.value || query.value) active.value = field.value ? 1 : 0
})
watch(active, async (i) => {
  await nextTick()
  list.value?.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: 'nearest' })
})
watch(open, (o) => {
  if (!o) {
    query.value = ''
    field.value = null
    active.value = 0
  }
})

function onKey(e: KeyboardEvent) {
  const n = rows.value.length
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if (e.key === 'Enter' && rows.value[active.value]) activate(rows.value[active.value])
  else if (e.key === 'ArrowRight' && rows.value[active.value]?.kind === 'field') enter((rows.value[active.value] as { field: FilterField }).field)
  else if ((e.key === 'ArrowLeft' || (e.key === 'Backspace' && !query.value)) && field.value) back()
  else return
  e.preventDefault()
}

/** Reopen the menu on one field (chip click) */
function openOn(key: string) {
  const f = props.fields.find((x) => x.key === key)
  open.value = true
  if (f) nextTick(() => enter(f))
}

// F opens the menu, unless typing somewhere
onKeyStroke('f', (e) => {
  const t = e.target as HTMLElement
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return
  e.preventDefault()
  open.value = true
})

defineExpose({ openOn })
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="ghost" size="sm" class="relative text-muted-foreground" title="Filter (F)">
        <PhFunnelSimple /> Filter
        <span v-if="activeCount" class="absolute -top-1 -right-1 size-2 rounded-full bg-primary" aria-label="Filters on" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-72 gap-0 p-0" @open-auto-focus.prevent="input?.focus()">
      <div class="flex items-center gap-2 border-b px-3">
        <input
          ref="input"
          v-model="query"
          class="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          :placeholder="field ? `${field.label}…` : 'Add filter…'"
          @keydown="onKey"
        />
        <kbd class="rounded border px-1.5 font-mono text-[10px] text-muted-foreground">F</kbd>
      </div>
      <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-96">
      <div ref="list" class="p-1" role="listbox">
        <template v-for="(r, i) in rows" :key="r.kind + r.field.key + (r.kind === 'option' ? r.option.value : '')">
          <div
            v-if="r.kind === 'field' && i > 0 && !query && rows[i - 1].kind === 'field' && (rows[i - 1].field.group ?? 0) !== (r.field.group ?? 0)"
            class="-mx-1 my-1 h-px bg-border"
          />
          <div
            :data-row="i"
            role="option"
            :aria-selected="i === active"
            :class="cn('flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm select-none', i === active && 'bg-accent text-accent-foreground')"
            @mousemove="active = i"
            @click="activate(r)"
          >
            <template v-if="r.kind === 'back'">
              <PhCaretLeft class="size-3.5 text-muted-foreground" />
              <component :is="r.field.icon" class="size-4 text-muted-foreground" />
              <span class="font-medium">{{ r.field.label }}</span>
              <button v-if="selected(r.field.key).length" type="button" class="ml-auto text-xs text-muted-foreground hover:text-foreground" @click.stop="clear(r.field.key)">Clear</button>
            </template>
            <template v-else-if="r.kind === 'field'">
              <component :is="r.field.icon" class="size-4 text-muted-foreground" />
              <span>{{ r.field.label }}</span>
              <span v-if="selected(r.field.key).length" class="ml-auto rounded-full bg-primary/15 px-1.5 text-xs text-primary tabular-nums">{{ selected(r.field.key).length }}</span>
              <PhCaretRight class="size-3 text-muted-foreground" :class="{ 'ml-auto': !selected(r.field.key).length }" />
            </template>
            <template v-else>
              <span
                :class="cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                  selected(r.field.key).includes(r.option.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )"
              >
                <PhCheck v-if="selected(r.field.key).includes(r.option.value)" class="size-3" weight="bold" />
              </span>
              <img v-if="r.option.avatar" :src="r.option.avatar" alt="" class="size-4 shrink-0 rounded-full" />
              <component :is="r.option.icon" v-else-if="r.option.icon" :class="cn('size-4 shrink-0', r.option.iconClass ?? 'text-muted-foreground')" />
              <span v-if="r.showField" class="shrink-0 text-muted-foreground">{{ r.field.label }} ›</span>
              <span :class="cn('min-w-0 truncate', r.field.mono && 'font-mono text-xs')" :title="r.option.hint ? `${r.option.hint}/${r.option.label}` : r.option.label">
                {{ r.option.label }}<span v-if="r.option.hint" class="ml-1.5 text-xs text-muted-foreground">{{ r.option.hint }}</span>
              </span>
              <span v-if="r.option.count !== undefined" class="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">{{ r.option.count }}</span>
            </template>
          </div>
        </template>
        <p v-if="!rows.length || (field && rows.length === 1)" class="px-2 py-6 text-center text-xs text-muted-foreground">No matches</p>
      </div>
      </ScrollArea>
      <div v-if="activeCount" class="border-t p-1">
        <button type="button" class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" @click="clear()">
          <PhX class="size-4" /> Clear all filters
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
