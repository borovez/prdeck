<script setup lang="ts">
import { computed, type Component } from 'vue'
import { PhArrowCounterClockwise, PhSlidersHorizontal, PhSortAscending, PhSortDescending } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export interface DisplayOption {
  value: string
  label: string
  icon?: Component
}
/**
 * One row of the menu, bound to `state[key]`:
 * - select: a labelled dropdown (grouping)
 * - order: a dropdown plus an ascending/descending toggle bound to `dirKey`
 * - switch: a labelled switch (show done)
 * - properties: pills that show or hide parts of each row; `state[key]` holds the hidden ones
 * - heading: a section title; every heading after the first starts a new section
 */
export type DisplayRow =
  | { type: 'select'; key: string; label: string; options: DisplayOption[] }
  | { type: 'order'; key: string; dirKey: string; label: string; options: DisplayOption[] }
  | { type: 'switch'; key: string; label: string }
  | { type: 'properties'; key: string; label: string; options: DisplayOption[] }
  | { type: 'heading'; label?: string }

/**
 * Linear-style display menu: layout switch (list/board) at the top, then grouping, ordering,
 * toggles and display properties. `defaults` drives Reset view and the "customised" dot.
 */
const props = defineProps<{
  state: Record<string, unknown>
  rows: DisplayRow[]
  defaults: Record<string, unknown>
  /** Layouts for the top switch, bound to `state[layoutKey]` (e.g. List / Board) */
  layouts?: DisplayOption[]
  layoutKey?: string
}>()

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const customised = computed(() => Object.keys(props.defaults).some((k) => !same(props.state[k], props.defaults[k])))
const reset = () => {
  for (const [k, v] of Object.entries(props.defaults)) props.state[k] = structuredClone(v)
}
const set = (key: string, value: unknown) => (props.state[key] = value)
const hidden = (key: string) => (props.state[key] as string[] | undefined) ?? []
function toggleProperty(key: string, value: string) {
  const h = hidden(key)
  set(key, h.includes(value) ? h.filter((x) => x !== value) : [...h, value])
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="sm" class="relative text-muted-foreground">
        <PhSlidersHorizontal /> Display
        <span v-if="customised" class="absolute -top-1 -right-1 size-2 rounded-full bg-primary" aria-label="Customised" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 gap-0 p-0">
      <div v-if="layouts && layoutKey" class="grid gap-1 border-b p-2" :style="{ gridTemplateColumns: `repeat(${layouts.length}, 1fr)` }">
        <button
          v-for="l in layouts"
          :key="l.value"
          type="button"
          :class="cn(
            'flex h-8 items-center justify-center gap-1.5 rounded-md border text-sm transition-colors',
            state[layoutKey] === l.value ? 'border-border bg-accent font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )"
          @click="set(layoutKey, l.value)"
        >
          <component :is="l.icon" v-if="l.icon" class="size-4" /> {{ l.label }}
        </button>
      </div>

      <div class="flex flex-col gap-0.5 p-3">
        <template v-for="(r, i) in rows" :key="i">
          <template v-if="r.type === 'heading'">
            <div v-if="i > 0" class="-mx-3 my-2 h-px bg-border" />
            <p v-if="r.label" class="pb-1 text-sm font-medium">{{ r.label }}</p>
          </template>

          <div v-else-if="r.type === 'select'" class="flex h-9 items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ r.label }}</span>
            <Select :model-value="state[r.key] as string" @update:model-value="(v) => set(r.key, v)">
              <SelectTrigger size="sm" class="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem v-for="o in r.options" :key="o.value" :value="o.value" class="text-xs">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-else-if="r.type === 'order'" class="flex h-9 items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ r.label }}</span>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-7 text-muted-foreground"
                :title="state[r.dirKey] === 'asc' ? 'Ascending' : 'Descending'"
                @click="set(r.dirKey, state[r.dirKey] === 'asc' ? 'desc' : 'asc')"
              >
                <PhSortAscending v-if="state[r.dirKey] === 'asc'" /><PhSortDescending v-else />
              </Button>
              <Select :model-value="state[r.key] as string" @update:model-value="(v) => set(r.key, v)">
                <SelectTrigger size="sm" class="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent align="end">
                  <SelectItem v-for="o in r.options" :key="o.value" :value="o.value" class="text-xs">{{ o.label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label v-else-if="r.type === 'switch'" class="flex h-9 cursor-pointer items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">{{ r.label }}</span>
            <Switch :model-value="!!state[r.key]" @update:model-value="(v) => set(r.key, v)" />
          </label>

          <div v-else-if="r.type === 'properties'" class="pt-1">
            <p class="pb-2 text-sm text-muted-foreground">{{ r.label }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="o in r.options"
                :key="o.value"
                type="button"
                :aria-pressed="!hidden(r.key).includes(o.value)"
                :class="cn(
                  'h-6 rounded-full border px-2.5 text-xs transition-colors',
                  hidden(r.key).includes(o.value)
                    ? 'border-border text-muted-foreground hover:text-foreground'
                    : 'border-transparent bg-foreground/12 font-medium text-foreground hover:bg-foreground/18',
                )"
                @click="toggleProperty(r.key, o.value)"
              >
                {{ o.label }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <div class="border-t p-1">
        <button
          type="button"
          :disabled="!customised"
          class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          @click="reset"
        >
          <PhArrowCounterClockwise class="size-4" /> Reset view
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
