<script setup lang="ts">
import { PhSortAscending, PhSortDescending } from '@phosphor-icons/vue'
import type { SortDir } from '@/stores/layout'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Toggles asc/desc. Labels default to generic wording; pass e.g. "Newest first" for time sorts. */
withDefaults(defineProps<{ size?: 'icon-xs' | 'icon-sm'; descLabel?: string; ascLabel?: string }>(), {
  size: 'icon-sm',
  descLabel: 'Descending',
  ascLabel: 'Ascending',
})
const dir = defineModel<SortDir>({ required: true })
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button variant="ghost" :size="size" :aria-label="dir === 'desc' ? descLabel : ascLabel" @click="dir = dir === 'desc' ? 'asc' : 'desc'">
        <PhSortDescending v-if="dir === 'desc'" /><PhSortAscending v-else />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ dir === 'desc' ? descLabel : ascLabel }}</TooltipContent>
  </Tooltip>
</template>
