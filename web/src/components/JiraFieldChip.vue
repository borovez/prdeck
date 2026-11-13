<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
  PhArrowsCounterClockwise,
  PhCalendarBlank,
  PhCellSignalHigh,
  PhCheck,
  PhCircleNotch,
  PhHash,
  PhListChecks,
  PhPlus,
  PhTag,
  PhTextAlignLeft,
  PhTreeStructure,
  PhUserCircle,
  PhX,
} from '@phosphor-icons/vue'
import type { JiraFieldMeta, JiraFieldOption, JiraFieldValue } from '@shared/types'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

/**
 * One property of the Jira composer as a chip: shows the value (or the field name when empty) and
 * opens a picker that fits the field: a searchable list (fixed options, or users / epics / sprints /
 * labels searched on Jira), a number, text or date input.
 */
const props = defineProps<{
  field: JiraFieldMeta
  /** Labels for values not in the field's options (users, parent, sprint) */
  known?: Record<string, JiraFieldOption>
  project: string
  /** Edit mode: assignable users are checked against the issue */
  issueKey?: string
  icon?: Component
  /** Highlights a required field without a value */
  invalid?: boolean
}>()
const model = defineModel<JiraFieldValue>()
const emit = defineEmits<{ learn: [options: JiraFieldOption[]] }>()

const open = ref(false)
const query = ref('')
const found = ref<JiraFieldOption[]>([])
const loading = ref(false)
const active = ref(0)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

const kind = computed(() => props.field.kind)
const isList = computed(() => ['option', 'options', 'user', 'users', 'labels', 'parent', 'sprint'].includes(kind.value))
const multi = computed(() => ['options', 'users', 'labels'].includes(kind.value))
const searched = computed(() => ['user', 'users', 'parent', 'sprint', 'labels'].includes(kind.value))
const selected = computed<string[]>(() => (Array.isArray(model.value) ? model.value : model.value === null || model.value === undefined || model.value === '' ? [] : [String(model.value)]))
const empty = computed(() => !selected.value.length)

const ICONS: Record<string, Component> = {
  option: PhListChecks,
  options: PhListChecks,
  user: PhUserCircle,
  users: PhUserCircle,
  labels: PhTag,
  parent: PhTreeStructure,
  sprint: PhArrowsCounterClockwise,
  number: PhHash,
  string: PhTextAlignLeft,
  text: PhTextAlignLeft,
  date: PhCalendarBlank,
}
const iconOf = computed(() => props.icon ?? (props.field.key === 'priority' ? PhCellSignalHigh : ICONS[kind.value]))

const optionFor = (id: string): JiraFieldOption =>
  props.field.options.find((o) => o.id === id) ?? props.known?.[id] ?? found.value.find((o) => o.id === id) ?? { id, label: id }

/** The chip's text */
const text = computed(() => {
  if (empty.value) return props.field.name
  const v = selected.value
  if (kind.value === 'number') return `${props.field.name}: ${v[0]}`
  if (kind.value === 'date') return `${props.field.name}: ${new Date(`${v[0]}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (kind.value === 'text' || kind.value === 'string') return `${props.field.name}: ${String(v[0]).replace(/\s+/g, ' ').slice(0, 28)}${String(v[0]).length > 28 ? '…' : ''}`
  if (kind.value === 'parent') return `${v[0]} ${optionFor(v[0]).label}`
  const first = optionFor(v[0]).label
  return v.length > 1 ? `${first} +${v.length - 1}` : first
})
const chipIcon = computed(() => (!empty.value && !multi.value && isList.value ? optionFor(selected.value[0]).iconUrl : null))

/** The list in the picker: fixed options filtered, or search results; labels can add what you typed */
const rows = computed<JiraFieldOption[]>(() => {
  const q = query.value.trim().toLowerCase()
  const base = searched.value ? found.value : props.field.options.filter((o) => !q || o.label.toLowerCase().includes(q))
  // Keep what's selected visible at the top when it isn't in the results
  const extra = selected.value.filter((id) => !base.some((o) => o.id === id) && (!q || optionFor(id).label.toLowerCase().includes(q))).map(optionFor)
  const list = [...extra, ...base]
  if (kind.value === 'labels' && q && !list.some((o) => o.label.toLowerCase() === q)) list.push({ id: query.value.trim().replace(/\s+/g, '-'), label: query.value.trim().replace(/\s+/g, '-'), detail: 'New label' })
  return list
})

watchDebounced(
  [open, query],
  async ([o, q]) => {
    if (!o || !searched.value) return
    loading.value = true
    try {
      found.value = await api.jiraOptions({ kind: kind.value, project: props.project, q, issue: props.issueKey, field: props.field.key })
    } catch {
      found.value = []
    } finally {
      loading.value = false
    }
  },
  { debounce: 200 },
)
watch(open, async (o) => {
  if (!o) return
  query.value = ''
  active.value = 0
  draft.value = selected.value[0] ?? ''
  await nextTick()
  input.value?.focus()
})
watch(query, () => (active.value = 0))

function pick(o: JiraFieldOption) {
  emit('learn', [o])
  if (multi.value) {
    model.value = selected.value.includes(o.id) ? selected.value.filter((x) => x !== o.id) : [...selected.value, o.id]
    if (kind.value === 'labels') query.value = ''
    return
  }
  model.value = selected.value[0] === o.id && !props.field.required ? null : o.id
  open.value = false
}
function clear() {
  model.value = multi.value ? [] : null
  open.value = false
}
function applyDraft() {
  const v = draft.value.trim()
  model.value = !v ? null : kind.value === 'number' ? Number(v) : draft.value
  open.value = false
}
function onKey(e: KeyboardEvent) {
  const n = rows.value.length
  if (!n) return
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if (e.key === 'Enter') pick(rows.value[active.value])
  else return
  e.preventDefault()
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-accent',
            empty ? 'border-dashed text-muted-foreground' : 'bg-background text-foreground',
            invalid && 'border-destructive/60 text-destructive',
          )
        "
        :title="empty ? `Set ${field.name}` : `${field.name}: ${text}`"
      >
        <img v-if="chipIcon" :src="chipIcon" alt="" class="size-3.5 rounded-sm" />
        <component :is="iconOf" v-else class="size-3.5" />
        <span class="truncate">{{ text }}</span>
        <span v-if="field.required && empty" class="text-destructive">*</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-72 gap-0 p-0">
      <!-- Lists: search, then options with checks -->
      <template v-if="isList">
        <div class="flex items-center gap-2 border-b px-3">
          <input
            ref="input"
            v-model="query"
            class="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            :placeholder="kind === 'labels' ? 'Search or add a label…' : `${field.name}…`"
            @keydown="onKey"
          />
          <PhCircleNotch v-if="loading" class="size-3.5 animate-spin text-muted-foreground" />
        </div>
        <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-72">
          <div class="p-1" role="listbox">
            <div
              v-for="(o, i) in rows"
              :key="o.id"
              role="option"
              :aria-selected="selected.includes(o.id)"
              :class="cn('flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm select-none', i === active && 'bg-accent')"
              @mousemove="active = i"
              @click="pick(o)"
            >
              <img v-if="o.iconUrl" :src="o.iconUrl" alt="" :class="cn('size-4 shrink-0', kind.startsWith('user') ? 'rounded-full' : 'rounded-sm')" />
              <PhPlus v-else-if="o.detail === 'New label'" class="size-4 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <div class="truncate">{{ o.label }}</div>
                <div v-if="o.detail" class="truncate text-xs text-muted-foreground">{{ o.detail }}</div>
              </div>
              <PhCheck v-if="selected.includes(o.id)" class="size-4 shrink-0 text-primary" />
            </div>
            <p v-if="!rows.length" class="px-2 py-5 text-center text-xs text-muted-foreground">
              {{ loading ? 'Searching…' : query ? 'No matches' : kind === 'parent' ? 'No open epics' : 'Nothing to choose' }}
            </p>
          </div>
        </ScrollArea>
      </template>

      <!-- Number, text, date -->
      <form v-else class="flex flex-col gap-2 p-3" @submit.prevent="applyDraft">
        <label class="text-xs text-muted-foreground">{{ field.name }}</label>
        <Textarea v-if="kind === 'text'" v-model="draft" rows="6" class="text-sm" @keydown.meta.enter.prevent="applyDraft" />
        <Input v-else ref="input" v-model="draft" :type="kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'" step="any" class="h-8" />
        <div class="flex justify-end gap-2">
          <button type="submit" class="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Set</button>
        </div>
      </form>

      <div v-if="!empty && !field.required" class="border-t p-1">
        <button type="button" class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" @click="clear">
          <PhX class="size-4" /> Clear {{ field.name.toLowerCase() }}
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
