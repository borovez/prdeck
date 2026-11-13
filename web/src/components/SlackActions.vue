<script setup lang="ts">
import { PhArrowCounterClockwise, PhArrowSquareOut, PhCheck, PhKanban, PhX } from '@phosphor-icons/vue'
import type { SlackItem } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { LAYER_OPEN } from '@/composables/escape'
import { neighbourId } from '@/composables/prNav'
import Kbd from './Kbd.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Open in Slack, create a Jira task, done / dismiss / back to inbox. Shared by the row (compact icons)
 * and the side panel (labelled buttons with keyboard shortcuts, moving on to the next message).
 */
const props = withDefaults(defineProps<{ item: SlackItem; showOpen?: boolean; labelled?: boolean }>(), { showOpen: true, labelled: false })
const deck = useDeck()

async function status(s: SlackItem['status']) {
  // In the panel, Done/Dismiss moves on to the next message in the list
  const next = props.labelled && s !== 'new' ? neighbourId('slack', props.item.id) : null
  let res: Awaited<ReturnType<typeof api.slackStatus>> | undefined
  const ok = await deck.mutate(async () => void (res = await api.slackStatus(props.item.id, s)))
  if (!ok) return
  const label = s === 'done' ? 'Marked done' : s === 'dismissed' ? 'Dismissed' : 'Back in inbox'
  // Todos also change in Slack (done reaction added / removed)
  if (res?.slack) toast.success(label, { description: res.slack.done ? `Added :${res.slack.reaction}: in Slack` : `Removed :${res.slack.reaction}: in Slack` })
  else if (res?.warning) toast.warning(`${label} in PR Deck only`, { description: res.warning })
  else toast.success(label)
  if (props.labelled && s !== 'new') deck.selectedSlackId = next
}
/** New Jira issue with this message as context: Claude reads the thread; created issues mark it done */
const jira = () =>
  (deck.composer = {
    mode: 'create',
    slackItemId: props.item.id,
    description: props.item.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n'),
  })

// Shortcuts while the panel is open and nothing else has the keyboard
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!props.labelled || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || document.querySelector(LAYER_OPEN)) return
  const k = e.key.toLowerCase()
  const open = props.item.status === 'new'
  const act = k === 'j' && !props.item.jiraKey ? jira : k === 'd' && open ? () => status('done') : k === 'x' && open ? () => status('dismissed') : k === 'u' && !open ? () => status('new') : null
  if (!act) return
  e.preventDefault()
  act()
})
</script>

<template>
  <div v-if="labelled" class="flex flex-1 flex-wrap items-center gap-2">
    <Button v-if="!item.jiraKey" size="sm" @click="jira"><PhKanban /> Create Jira task <Kbd>J</Kbd></Button>
    <span class="flex-1" />
    <template v-if="item.status === 'new'">
      <Button size="sm" variant="outline" @click="status('dismissed')"><PhX /> Dismiss <Kbd>X</Kbd></Button>
      <Button size="sm" variant="outline" @click="status('done')"><PhCheck /> Done <Kbd>D</Kbd></Button>
    </template>
    <Button v-else size="sm" variant="outline" @click="status('new')"><PhArrowCounterClockwise /> Back to inbox <Kbd>U</Kbd></Button>
  </div>
  <div v-else class="flex shrink-0 items-start gap-0.5" @click.stop>
    <Tooltip v-if="showOpen && item.permalink">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" as="a" :href="item.permalink" target="_blank" aria-label="Open in Slack"><PhArrowSquareOut /></Button>
      </TooltipTrigger>
      <TooltipContent>Open in Slack</TooltipContent>
    </Tooltip>
    <Tooltip v-if="!item.jiraKey">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" aria-label="Create Jira task" @click="jira"><PhKanban /></Button>
      </TooltipTrigger>
      <TooltipContent>Create Jira task with Claude</TooltipContent>
    </Tooltip>
    <template v-if="item.status === 'new'">
      <Tooltip>
        <TooltipTrigger as-child><Button variant="ghost" size="icon-xs" aria-label="Done" @click="status('done')"><PhCheck /></Button></TooltipTrigger>
        <TooltipContent>Done</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child><Button variant="ghost" size="icon-xs" aria-label="Dismiss" @click="status('dismissed')"><PhX /></Button></TooltipTrigger>
        <TooltipContent>Dismiss</TooltipContent>
      </Tooltip>
    </template>
    <Tooltip v-else>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" aria-label="Back to inbox" @click="status('new')"><PhArrowCounterClockwise /></Button>
      </TooltipTrigger>
      <TooltipContent>Back to inbox</TooltipContent>
    </Tooltip>
  </div>
</template>
