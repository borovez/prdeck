<script setup lang="ts">
import { computed } from 'vue'
import { useDeck } from '@/stores/deck'
import { jiraTone } from '@/utils/format'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ issueKey: string; showSummary?: boolean }>()
const deck = useDeck()
const issue = computed(() => deck.jiraByKey.get(props.issueKey))
/** Opens the Jira panel; Cmd/Ctrl-click opens Jira */
function open(e: MouseEvent) {
  if (e.metaKey || e.ctrlKey) return
  e.preventDefault()
  deck.selectedJiraKey = props.issueKey
}
const href = computed(
  () => issue.value?.url ?? (deck.overview?.jiraBaseUrl ? `${deck.overview.jiraBaseUrl}/browse/${props.issueKey}` : undefined),
)
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener"
    class="inline-flex max-w-full items-center gap-1 text-xs"
    :title="issue ? `${issue.key}: ${issue.summary} — ${issue.status}` : issueKey"
    @click.stop="open"
  >
    <img v-if="issue?.typeIconUrl" :src="issue.typeIconUrl" class="size-3.5" alt="" />
    <span class="font-mono font-medium whitespace-nowrap hover:underline">{{ issueKey }}</span>
    <Badge v-if="issue" :variant="jiraTone(issue.statusCategory)" class="h-4 max-w-40 truncate px-1.5 text-[10px]">{{ issue.status }}</Badge>
    <span v-if="showSummary && issue" class="truncate text-muted-foreground">{{ issue.summary }}</span>
  </a>
</template>
