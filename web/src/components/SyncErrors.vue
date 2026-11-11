<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowsClockwise, PhGithubLogo, PhKanban, PhSlackLogo, PhWarning } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { parseSyncError } from '@/utils/syncErrors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Header badge for the last sync's errors: short summaries on hover, details in a dialog */
const deck = useDeck()
const open = ref(false)
const errors = computed(() => (deck.overview?.sync.errors ?? []).map(parseSyncError))
const ICON = { github: PhGithubLogo, jira: PhKanban, slack: PhSlackLogo, other: PhWarning }
</script>

<template>
  <template v-if="errors.length">
    <Tooltip>
      <TooltipTrigger as-child>
        <button type="button" @click="open = true">
          <Badge variant="warning" class="cursor-pointer"><PhWarning />{{ errors.length }} sync error{{ errors.length === 1 ? '' : 's' }}</Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent class="max-w-sm">
        <ul class="space-y-0.5">
          <li v-for="(e, i) in errors" :key="i"><span class="font-medium">{{ e.source }}</span> · {{ e.summary }}</li>
        </ul>
        <div class="mt-1 opacity-70">Click for details</div>
      </TooltipContent>
    </Tooltip>

    <Dialog v-model:open="open">
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sync errors</DialogTitle>
          <DialogDescription>From the last sync. Everything else synced normally.</DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div v-for="(e, i) in errors" :key="i" class="rounded-lg border p-3 text-sm">
            <div class="flex items-center gap-2">
              <component :is="ICON[e.kind]" class="size-4 text-muted-foreground" />
              <span class="font-medium">{{ e.source }}</span>
              <span v-if="e.context" class="text-muted-foreground">· {{ e.context }}</span>
            </div>
            <div class="mt-1.5 font-medium text-warning">{{ e.summary }}</div>
            <p v-if="e.hint" class="mt-1 text-muted-foreground">{{ e.hint }}</p>
            <div v-if="e.repos.length" class="mt-2 flex flex-wrap gap-1">
              <Badge v-for="r in e.repos" :key="r" variant="muted" class="font-mono text-[11px]">{{ r }}</Badge>
            </div>
            <div v-if="e.query" class="mt-1.5 font-mono text-xs text-muted-foreground">{{ e.query }}</div>
            <Collapsible class="mt-2">
              <CollapsibleTrigger class="text-xs text-muted-foreground hover:text-foreground">Original message</CollapsibleTrigger>
              <CollapsibleContent>
                <pre class="mt-1 rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">{{ e.message }}</pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" @click="open = false">Close</Button>
          <Button :disabled="deck.syncing" @click="deck.sync()"><PhArrowsClockwise :class="{ 'animate-spin': deck.syncing }" /> Sync now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </template>
</template>
