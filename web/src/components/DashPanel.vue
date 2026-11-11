<script setup lang="ts">
import { ref } from 'vue'
import {
  PhArrowsInLineHorizontal,
  PhArrowsOutLineHorizontal,
  PhCaretDown,
  PhCaretRight,
  PhDotsSixVertical,
  PhDotsThreeVertical,
  PhEyeSlash,
  PhPushPin,
  PhSortAscending,
  PhSortDescending,
  PhTrash,
} from '@phosphor-icons/vue'
import { useLayout, type PanelConfig } from '@/stores/layout'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
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
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ panel: PanelConfig; count: number; sortOptions?: { value: string; label: string }[] }>()
const layout = useLayout()
const set = (patch: Partial<PanelConfig>) => layout.update(props.panel.id, patch)

// HTML5 drag & drop reorder, started from the handle only
const dragOver = ref(false)
const draggable = ref(false)
function onDragStart(e: DragEvent) {
  e.dataTransfer!.setData('text/panel', props.panel.id)
  e.dataTransfer!.effectAllowed = 'move'
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const from = e.dataTransfer?.getData('text/panel')
  if (from) layout.move(from, props.panel.id)
}
const LIMITS = [5, 8, 12, 20, 50, 999]
</script>

<template>
  <Card
    :class="cn('gap-0 overflow-visible py-0 transition-shadow', panel.width === 'full' && 'lg:col-span-2', dragOver && 'ring-2 ring-primary')"
    :draggable="draggable"
    @dragstart="onDragStart"
    @dragend="draggable = false"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <header :class="cn('flex items-center gap-1 px-2 py-1.5', !panel.collapsed && 'border-b')">
      <span
        class="cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
        title="Drag to reorder"
        @mousedown="draggable = true"
        @mouseup="draggable = false"
      >
        <PhDotsSixVertical :size="16" />
      </span>
      <Button variant="ghost" size="sm" class="h-7 gap-1 px-1.5" @click="set({ collapsed: !panel.collapsed })">
        <PhCaretRight v-if="panel.collapsed" /><PhCaretDown v-else />
        <span class="font-semibold">{{ panel.title }}</span>
      </Button>
      <Badge :variant="count ? 'primary' : 'muted'">{{ count }}</Badge>
      <PhPushPin v-if="panel.pinned" :size="13" weight="fill" class="text-primary" />
      <span class="flex-1" />

      <slot name="toolbar" />

      <template v-if="sortOptions?.length && !panel.collapsed">
        <NativeSelect
          size="sm"
          class="h-7 text-xs"
          :model-value="panel.sort"
          title="Sort"
          @update:model-value="set({ sort: String($event) as PanelConfig['sort'] })"
        >
          <NativeSelectOption v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</NativeSelectOption>
        </NativeSelect>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-xs" @click="set({ dir: panel.dir === 'desc' ? 'asc' : 'desc' })">
              <PhSortDescending v-if="panel.dir === 'desc'" /><PhSortAscending v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ panel.dir === 'desc' ? 'Descending' : 'Ascending' }}</TooltipContent>
        </Tooltip>
      </template>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-xs" class="hidden lg:inline-flex" @click="set({ width: panel.width === 'full' ? 'half' : 'full' })">
            <PhArrowsInLineHorizontal v-if="panel.width === 'full'" /><PhArrowsOutLineHorizontal v-else />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ panel.width === 'full' ? 'Half width' : 'Full width' }}</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-xs"><PhDotsThreeVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-60">
          <DropdownMenuItem @select="set({ pinned: !panel.pinned })"><PhPushPin /> {{ panel.pinned ? 'Unpin' : 'Pin to top' }}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Show {{ panel.limit === 999 ? 'all' : panel.limit }} items</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup :model-value="String(panel.limit)" @update:model-value="set({ limit: Number($event) })">
                <DropdownMenuRadioItem v-for="n in LIMITS" :key="n" :value="String(n)">{{ n === 999 ? 'All' : n }}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-xs text-muted-foreground">Title</DropdownMenuLabel>
          <div class="px-2 pb-2">
            <Input class="h-7 text-xs" :model-value="panel.title" @change="set({ title: ($event.target as HTMLInputElement).value })" @keydown.stop />
          </div>
          <slot name="menu" />
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="set({ visible: false })"><PhEyeSlash /> Hide panel</DropdownMenuItem>
          <DropdownMenuItem v-if="!panel.builtin" variant="destructive" @select="layout.removePanel(panel.id)"><PhTrash /> Delete panel</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <div v-show="!panel.collapsed" class="p-1.5">
      <slot />
    </div>
  </Card>
</template>
