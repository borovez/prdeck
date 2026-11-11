<script setup lang="ts">
import { ref } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'
import { api } from '@/api'
import { transitionsFor } from '@/composables/jiraTransitions'
import { useDeck } from '@/stores/deck'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Status menu (Jira transitions). `prominent` renders a regular button, e.g. in the panel's bottom bar. */
const props = defineProps<{ issueKey: string; prominent?: boolean }>()
const deck = useDeck()
const transitions = ref<{ id: string; name: string; to: string }[] | null>(null)
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
      <Button :variant="prominent ? 'default' : 'ghost'" :size="prominent ? 'sm' : 'xs'" :disabled="busy" @click.stop>Change status <PhCaretDown /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-max min-w-48 max-w-sm">
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
