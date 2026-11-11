<script setup lang="ts">
import { computed } from 'vue'
import type { JiraLink } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { jiraTone } from '@/utils/format'
import { Badge } from '@/components/ui/badge'

/**
 * An issue's Jira links in aligned columns (relation, key, title, status). Blocking links come first;
 * Jira can return the same link twice. Keys and titles open the linked issue in the Jira panel
 * (Cmd/Ctrl-click: in Jira).
 */
const props = defineProps<{ links: JiraLink[] }>()
const deck = useDeck()
const ORDER = ['is blocked by', 'blocks']
const sorted = computed(() => {
  const seen = new Set<string>()
  const rank = (l: JiraLink) => ORDER.indexOf(l.label) + 1 || ORDER.length + 1
  return props.links
    .filter((l) => !seen.has(l.label + l.key) && seen.add(l.label + l.key))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
})
const url = (key: string) => (deck.overview?.jiraBaseUrl ? `${deck.overview.jiraBaseUrl}/browse/${key}` : undefined)
function open(e: MouseEvent, key: string) {
  if (e.metaKey || e.ctrlKey) return
  e.preventDefault()
  deck.selectedJiraKey = key
}
</script>

<template>
  <ul v-if="sorted.length" class="grid grid-cols-[max-content_max-content_minmax(0,1fr)_max-content] items-center gap-x-3 gap-y-1 text-xs">
    <li v-for="l in sorted" :key="l.key + l.label" class="contents">
      <span class="whitespace-nowrap text-muted-foreground">{{ l.label }}</span>
      <a :href="url(l.key)" target="_blank" rel="noopener" class="font-mono whitespace-nowrap underline underline-offset-2 hover:text-primary" @click="open($event, l.key)">{{ l.key }}</a>
      <a :href="url(l.key)" target="_blank" rel="noopener" class="truncate underline underline-offset-2 hover:text-primary" :title="l.summary" @click="open($event, l.key)">{{ l.summary }}</a>
      <Badge :variant="jiraTone(l.statusCategory)" class="h-4 justify-self-end text-[10px]">{{ l.status }}</Badge>
    </li>
  </ul>
</template>
