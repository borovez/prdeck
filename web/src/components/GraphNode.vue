<script lang="ts">
import type { JiraIssue, PrView } from '@shared/types'

export const CARD_W = 264
const CARD_H = 114
/** PrCard height: the Jira rows (issue, then its epic/parent) add to the base card */
export function cardHeight(pr: PrView | null | undefined, jiraByKey: Map<string, JiraIssue>): number {
  const key = pr?.jiraKeys[0]
  if (!key) return CARD_H
  return CARD_H + 30 + (jiraByKey.get(key)?.parent ? 20 : 0)
}

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
