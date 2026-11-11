<script setup lang="ts">
import { ref } from 'vue'
import { PhCaretDown, PhPencilSimple } from '@phosphor-icons/vue'
import { computed } from 'vue'
import { api } from '@/api'
import { transitionsFor } from '@/composables/jiraTransitions'
import { useDeck } from '@/stores/deck'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Status menu (Jira transitions). `prominent` renders a regular button, e.g. in the panel's bottom bar. */
const props = defineProps<{ issueKey: string; prominent?: boolean }>()
const deck = useDeck()
const transitions = ref<{ id: string; name: string; to: string }[] | null>(null)
/** Same soft tones as the status badges */
const STATUS_BUTTON: Record<string, string> = {
  done: 'bg-success/12 text-success hover:bg-success/20 hover:text-success dark:bg-success/18',
  indeterminate: 'bg-info/12 text-info hover:bg-info/20 hover:text-info dark:bg-info/18',
  new: 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
}
const issue = computed(() => deck.jiraByKey.get(props.issueKey))
const busy = ref(false)
const error = ref('')

async function load(open: boolean) {
  if (!open) return
  error.value = ''
  try {
    transitions.value = await transitionsFor(props.issueKey, deck.jiraByKey.get(props.issueKey))
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function run(t: { id: string; to: string }) {
  busy.value = true
  // The new status has its own (cached) list; fetch it on next open
  if (await deck.mutate(() => api.transition(props.issueKey, t.id), `${props.issueKey} → ${t.to}`)) transitions.value = null
  busy.value = false
}
</script>

<template>
  <DropdownMenu @update:open="load">
    <DropdownMenuTrigger as-child>
      <!-- One button tinted by status: edit icon, current status, chevron -->
      <Button
        variant="ghost"
        :size="prominent ? 'sm' : 'xs'"
        :disabled="busy"
        :class="issue && STATUS_BUTTON[issue.statusCategory] || STATUS_BUTTON.new"
        :title="`Change status of ${issueKey}`"
        :aria-label="`Status: ${issue?.status ?? 'unknown'}. Change status`"
        @click.stop
      >
        <PhPencilSimple class="opacity-70" />
        <span class="font-semibold">{{ issue?.status ?? 'Change status' }}</span>
        <PhCaretDown class="opacity-70" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-max min-w-48 max-w-sm">
      <DropdownMenuLabel class="text-xs text-muted-foreground">Change status</DropdownMenuLabel>
      <DropdownMenuLabel v-if="error" class="text-xs text-destructive">{{ error }}</DropdownMenuLabel>
      <DropdownMenuLabel v-else-if="!transitions" class="text-xs text-muted-foreground">Loading…</DropdownMenuLabel>
      <DropdownMenuItem v-for="t in transitions ?? []" :key="t.id" @select="run(t)">
        <span class="whitespace-nowrap">{{ t.name }}</span>
        <span
          v-if="t.to.toLowerCase() !== t.name.toLowerCase()"
          class="ml-auto pl-4 text-xs whitespace-nowrap text-muted-foreground"
          :title="`Moves to the status ${t.to}`"
        >
          → {{ t.to }}
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
