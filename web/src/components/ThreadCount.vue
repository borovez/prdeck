<script setup lang="ts">
import { PhChatCircleDots } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Unresolved conversation count; opens the PR drawer on its Conversations tab. */
const props = defineProps<{ pr: PrView }>()
const deck = useDeck()
const drawer = useLayout().view('drawer', { tab: 'details' as 'details' | 'description' | 'files' | 'conversations' })

function open() {
  drawer.tab = 'conversations'
  deck.selectedId = props.pr.id
}
</script>

<template>
  <Tooltip v-if="pr.unresolvedThreads">
    <TooltipTrigger as-child>
      <button
        type="button"
        class="flex shrink-0 items-center gap-0.5 rounded-md px-1 text-xs font-medium text-warning tabular-nums hover:bg-warning/10"
        :aria-label="`${pr.unresolvedThreads} unresolved conversations`"
        @click.stop="open"
      >
        <PhChatCircleDots :size="15" weight="fill" />{{ pr.unresolvedThreads }}
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ pr.unresolvedThreads }} unresolved conversation{{ pr.unresolvedThreads === 1 ? '' : 's' }}</TooltipContent>
  </Tooltip>
</template>
