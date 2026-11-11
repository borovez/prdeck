<script lang="ts">
import type { PrView } from '@shared/types'

export interface GraphNodeData {
  id: string
  pr: PrView | null
  /** CSS colour for the org stripe */
  color: string
  isNext: boolean
}
</script>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import PrCard from './PrCard.vue'

defineProps<{ data: GraphNodeData; selected?: boolean }>()
</script>

<template>
  <PrCard :id="data.id" :pr="data.pr" :is-next="data.isNext" :accent="data.color" :selected="selected" class="w-[264px]">
    <Handle type="target" :position="Position.Left" class="graph-handle" />
    <Handle type="source" :position="Position.Right" class="graph-handle" />
  </PrCard>
</template>
