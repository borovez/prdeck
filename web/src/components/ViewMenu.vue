<script setup lang="ts">
import { ScrollArea } from '@/components/ui/scroll-area'
import { computed, type Component } from 'vue'
import { PhArrowCounterClockwise, PhSlidersHorizontal, PhSortAscending, PhSortDescending } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ViewOption {
  value: string
  label: string
}
/**
 * One block of the menu, bound to `state[key]`:
 * - filter: a submenu of options with an "all" entry ('' value), for long lists (repos, projects)
 * - radio: a labelled radio group (group by, sort by)
 * - dir: Descending / Ascending (or your own labels, e.g. Newest first / Oldest first)
 * - check: a checkbox (show done)
 */
export type ViewSection =
  | { type: 'filter'; key: string; label: string; icon?: Component; allLabel: string; options: ViewOption[]; mono?: boolean }
  | { type: 'radio'; key: string; label: string; options: ViewOption[] }
  | { type: 'dir'; key: string; desc?: string; asc?: string }
  | { type: 'check'; key: string; label: string }

/** The view menu shared by list pages. `defaults` drives Reset view and the "customised" dot. */
const props = defineProps<{ state: Record<string, unknown>; sections: ViewSection[]; defaults: Record<string, unknown> }>()

const customised = computed(() => Object.keys(props.defaults).some((k) => props.state[k] !== props.defaults[k]))
const reset = () => Object.assign(props.state, props.defaults)
const model = (key: string) => ({
  get: () => props.state[key] as string,
  set: (v: unknown) => (props.state[key] = v),
})
const labelOf = (s: Extract<ViewSection, { type: 'filter' }>) => s.options.find((o) => o.value === props.state[s.key])?.label ?? s.allLabel
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="relative text-muted-foreground">
        <PhSlidersHorizontal /> View
        <span v-if="customised" class="absolute -top-1 -right-1 size-2 rounded-full bg-primary" aria-label="Customised" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-60">
      <template v-for="(s, i) in sections" :key="s.type + s.key">
        <DropdownMenuSeparator v-if="i > 0 && !(s.type === 'filter' && sections[i - 1].type === 'filter')" />

        <DropdownMenuSub v-if="s.type === 'filter'">
          <DropdownMenuSubTrigger>
            <component :is="s.icon" v-if="s.icon" /> {{ s.label }}
            <span class="ml-auto max-w-28 truncate pl-2 text-xs text-muted-foreground">{{ labelOf(s) }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="w-72 p-0">
            <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-80">
            <DropdownMenuRadioGroup class="p-1" :model-value="model(s.key).get()" @update:model-value="model(s.key).set">
              <DropdownMenuRadioItem value="">{{ s.allLabel }}</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem v-for="o in s.options" :key="o.value" :value="o.value" :class="cn(s.mono && 'font-mono text-xs')">
                {{ o.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            </ScrollArea>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <template v-else-if="s.type === 'radio'">
          <DropdownMenuLabel class="text-xs text-muted-foreground">{{ s.label }}</DropdownMenuLabel>
          <DropdownMenuRadioGroup :model-value="model(s.key).get()" @update:model-value="model(s.key).set">
            <DropdownMenuRadioItem v-for="o in s.options" :key="o.value" :value="o.value">{{ o.label }}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </template>

        <DropdownMenuRadioGroup v-else-if="s.type === 'dir'" :model-value="model(s.key).get()" @update:model-value="model(s.key).set">
          <DropdownMenuRadioItem value="desc"><PhSortDescending /> {{ s.desc ?? 'Descending' }}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="asc"><PhSortAscending /> {{ s.asc ?? 'Ascending' }}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuCheckboxItem v-else-if="s.type === 'check'" :model-value="!!state[s.key]" @update:model-value="model(s.key).set" @select.prevent>
          {{ s.label }}
        </DropdownMenuCheckboxItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="!customised" @select="reset"><PhArrowCounterClockwise /> Reset view</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
