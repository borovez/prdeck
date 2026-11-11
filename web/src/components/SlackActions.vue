<script setup lang="ts">
import { PhArrowCounterClockwise, PhArrowSquareOut, PhCheck, PhKanban, PhX } from '@phosphor-icons/vue'
import type { SlackItem } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Open in Slack, create a Jira task, done / dismiss / back to inbox. Shared by the row and the panel. */
const props = withDefaults(defineProps<{ item: SlackItem; showOpen?: boolean }>(), { showOpen: true })
const deck = useDeck()
const status = (s: SlackItem['status']) => deck.mutate(() => api.slackStatus(props.item.id, s))
</script>

<template>
  <div class="flex shrink-0 items-start gap-0.5" @click.stop>
    <Tooltip v-if="showOpen && item.permalink">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" as="a" :href="item.permalink" target="_blank" aria-label="Open in Slack"><PhArrowSquareOut /></Button>
      </TooltipTrigger>
      <TooltipContent>Open in Slack</TooltipContent>
    </Tooltip>
    <Tooltip v-if="!item.jiraKey">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" aria-label="Create Jira task" @click="deck.slackToJira = item"><PhKanban /></Button>
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
