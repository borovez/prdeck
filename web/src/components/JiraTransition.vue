<script setup lang="ts">
import { ref } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'
import { api } from '@/api'
import { transitionsFor } from '@/composables/jiraTransitions'
import { useDeck } from '@/stores/deck'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{ issueKey: string }>()
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
      <Button variant="ghost" size="xs" :disabled="busy" @click.stop>Move <PhCaretDown /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuLabel v-if="error" class="text-xs text-destructive">{{ error }}</DropdownMenuLabel>
      <DropdownMenuLabel v-else-if="!transitions" class="text-xs text-muted-foreground">Loading…</DropdownMenuLabel>
      <DropdownMenuItem v-for="t in transitions ?? []" :key="t.id" @select="run(t)">
        {{ t.name }}
        <span v-if="t.to.toLowerCase() !== t.name.toLowerCase()" class="ml-auto text-xs text-muted-foreground">→ {{ t.to }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
