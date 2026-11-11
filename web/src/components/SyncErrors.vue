<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowsClockwise, PhCheck, PhCopy, PhGithubLogo, PhKanban, PhSlackLogo, PhWarning } from '@phosphor-icons/vue'
import { useClipboard } from '@vueuse/core'
import { useDeck } from '@/stores/deck'
import { parseSyncError } from '@/utils/syncErrors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

/** Header badge for the last sync's errors: short summaries on hover, details in a dialog */
const deck = useDeck()
const open = ref(false)
const errors = computed(() => (deck.overview?.sync.errors ?? []).map(parseSyncError))
const ICON = { github: PhGithubLogo, jira: PhKanban, slack: PhSlackLogo, other: PhWarning }
// ---- Copy, for sharing when debugging: the original messages plus when the sync ran
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const copiedOne = ref<number | null>(null)
const report = () => {
  const s = deck.overview?.sync
  return [
    `PR Deck sync errors (${errors.value.length})`,
    `Last sync: started ${s?.lastStartedAt ?? 'unknown'}, finished ${s?.lastFinishedAt ?? 'unknown'}`,
    '',
    ...errors.value.map((e, i) => `${i + 1}. ${e.raw}`),
  ].join('\n')
}
async function copyOne(i: number) {
  await copy(errors.value[i].raw)
  copiedOne.value = i
  setTimeout(() => copiedOne.value === i && (copiedOne.value = null), 1500)
}

/** Same source + summary merged, with a count (e.g. two rate-limited searches) */
const summaries = computed(() => {
  const map = new Map<string, { key: string; source: string; summary: string; kind: keyof typeof ICON; count: number }>()
  for (const e of errors.value) {
    const key = `${e.source}|${e.summary}`
    const s = map.get(key)
    if (s) s.count++
    else map.set(key, { key, source: e.source, summary: e.summary, kind: e.kind, count: 1 })
  }
  return [...map.values()]
})
</script>

<template>
  <template v-if="errors.length">
    <HoverCard :open-delay="200" :close-delay="150">
      <HoverCardTrigger as-child>
        <button type="button" @click="open = true">
          <Badge variant="warning" class="cursor-pointer"><PhWarning />{{ errors.length }} sync error{{ errors.length === 1 ? '' : 's' }}</Badge>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" class="w-80 space-y-3 p-3">
        <ul class="space-y-1.5 text-sm">
          <li v-for="s in summaries" :key="s.key" class="flex items-start gap-2">
            <component :is="ICON[s.kind]" class="mt-0.5 size-4 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="font-medium">{{ s.source }}</span>
              <span class="block text-muted-foreground">{{ s.summary }}</span>
            </span>
            <Badge v-if="s.count > 1" variant="count">×{{ s.count }}</Badge>
          </li>
        </ul>
        <Button size="sm" variant="outline" class="w-full" @click="open = true">View details</Button>
      </HoverCardContent>
    </HoverCard>

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
              <span v-if="e.context" class="min-w-0 flex-1 truncate text-muted-foreground">· {{ e.context }}</span>
              <span v-else class="flex-1" />
              <Button variant="ghost" size="icon-xs" :aria-label="copiedOne === i ? 'Copied' : 'Copy this error'" :title="copiedOne === i ? 'Copied' : 'Copy this error'" @click="copyOne(i)">
                <PhCheck v-if="copiedOne === i" class="text-success" /><PhCopy v-else />
              </Button>
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
          <Button variant="outline" class="sm:mr-auto" @click="copy(report())">
            <PhCheck v-if="copied && copiedOne === null" class="text-success" /><PhCopy v-else /> {{ copied && copiedOne === null ? 'Copied' : 'Copy all' }}
          </Button>
          <Button variant="ghost" @click="open = false">Close</Button>
          <Button :disabled="deck.syncing" @click="deck.sync()"><PhArrowsClockwise :class="{ 'animate-spin': deck.syncing }" /> Sync now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </template>
</template>
