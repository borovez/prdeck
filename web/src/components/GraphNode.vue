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
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { PhArrowRight, PhCheckCircle, PhCircleNotch, PhCloudSlash, PhGitMerge, PhRocketLaunch, PhXCircle } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE, CHECK_STYLE, jiraTone, shortId } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ data: GraphNodeData; selected?: boolean }>()
const deck = useDeck()
const pr = computed(() => props.data.pr)
const check = computed(() => (pr.value ? CHECK_STYLE[pr.value.checks.state] : null))
const jira = computed(() => {
  const key = pr.value?.jiraKeys[0]
  return key ? { key, issue: deck.jiraByKey.get(key) } : null
})
</script>

<template>
  <div
    :class="cn(
      'relative w-[264px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow hover:shadow-md',
      !pr && 'border-dashed bg-muted/40 text-muted-foreground shadow-none',
      data.isNext && 'ring-2 ring-primary',
      (selected || deck.selectedId === data.id) && 'ring-2 ring-ring',
    )"
  >
    <span class="absolute inset-y-0 left-0 w-1" :style="{ background: data.color }" />
    <Handle type="target" :position="Position.Left" class="graph-handle" />
    <Handle type="source" :position="Position.Right" class="graph-handle" />

    <div class="space-y-1.5 py-2 pr-3 pl-4">
      <div class="flex items-center gap-1.5 text-xs">
        <span class="truncate font-mono font-medium" :title="data.id">{{ shortId(data.id) }}</span>
        <span class="flex-1" />
        <Badge v-if="data.isNext" variant="primary" class="h-4 gap-0.5 px-1.5 text-[10px]"><PhArrowRight />Next</Badge>
        <template v-if="pr">
          <span v-if="pr.state === 'OPEN' && check" :title="check.label" class="flex">
            <PhCheckCircle v-if="pr.checks.state === 'SUCCESS'" :size="15" weight="fill" :class="check.cls" />
            <PhXCircle v-else-if="pr.checks.state === 'FAILURE' || pr.checks.state === 'ERROR'" :size="15" weight="fill" :class="check.cls" />
            <PhCircleNotch v-else :size="15" :class="check.cls" />
          </span>
          <PhGitMerge v-else-if="pr.state === 'MERGED'" :size="15" class="text-merged" title="Merged" />
          <PhRocketLaunch v-if="pr.release?.released" :size="14" class="text-success" title="Released" />
        </template>
      </div>

      <template v-if="pr">
        <div class="line-clamp-2 text-[13px] leading-snug font-medium" :class="{ 'text-muted-foreground': pr.isDraft }" :title="pr.title">
          {{ pr.title }}
        </div>
        <div class="flex items-center gap-1.5">
          <Badge :variant="ACTION_TONE[pr.action.kind]" class="h-5 truncate text-[11px]">{{ pr.action.label }}</Badge>
          <span class="flex-1" />
          <span v-if="jira" class="flex min-w-0 items-center gap-1 text-[11px]" :title="jira.issue ? `${jira.key}: ${jira.issue.summary}` : jira.key">
            <span class="font-mono">{{ jira.key }}</span>
            <Badge v-if="jira.issue" :variant="jiraTone(jira.issue.statusCategory)" class="h-4 truncate px-1 text-[10px]">{{ jira.issue.status }}</Badge>
          </span>
        </div>
      </template>
      <div v-else class="flex items-center gap-1.5 text-xs"><PhCloudSlash :size="14" />Not synced yet</div>
    </div>
  </div>
</template>
