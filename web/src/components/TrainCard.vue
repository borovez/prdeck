<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowBendDownRight, PhLinkSimple, PhTrain, PhWarning } from '@phosphor-icons/vue'
import type { ReleaseTrain } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import PrRow from './PrRow.vue'
import RepoName from './RepoName.vue'
import JiraPill from './JiraPill.vue'
import FlagChip from './FlagChip.vue'
import { useReleaseFlags } from '@/composables/flags'

/**
 * One release train: releases across repos in the suggested shipping order, why they belong together,
 * and "Ships after…" to set an order (adds a dependency between the release PRs).
 */
const props = defineProps<{ train: ReleaseTrain }>()
const deck = useDeck()

const flagsOf = useReleaseFlags()
/** Every flag the train's releases name */
const flags = computed(() => [...new Set(props.train.releases.flatMap((id) => flagsOf(id)))])
const repos = computed(() => new Set(props.train.releases.map((id) => id.split('#')[0])).size)
const hasOrder = computed(() => props.train.links.some((l) => l.kind === 'order'))
const steps = computed(() =>
  props.train.releases.map((id, i) => ({
    id,
    n: i + 1,
    pr: deck.byId.get(id),
    after: props.train.links.filter((l) => l.kind === 'order' && l.to === id),
    shares: props.train.links.filter((l) => l.kind === 'jira' && (l.from === id || l.to === id)),
  })),
)
const other = (l: ReleaseTrain['links'][number], id: string) => (l.from === id ? l.to : l.from)
</script>

<template>
  <Card class="gap-0 py-0">
    <div class="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <PhTrain :size="16" class="text-primary" />
      <span class="text-sm font-semibold">Release train</span>
      <span class="text-xs text-muted-foreground">{{ train.releases.length }} releases across {{ repos }} repos</span>
      <Badge v-if="train.cycle" variant="warning"><PhWarning />Circular order</Badge>
      <span class="flex-1" />
      <span v-if="train.jiraKeys.length" class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-muted-foreground">Shared</span>
        <JiraPill v-for="k in train.jiraKeys" :key="k" :issue-key="k" />
      </span>
    </div>

    <div v-if="flags.length" class="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
      <span class="text-xs text-muted-foreground">Flags</span>
      <FlagChip v-for="k in flags" :key="k" :flag-key="k" />
    </div>

    <p v-if="!hasOrder" class="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      No shipping order yet: these releases ship the same Jira issues. Open a release and set the order in its Release train
      section.
    </p>

    <ol class="divide-y">
      <li v-for="s in steps" :key="s.id" class="flex items-start gap-3 px-3 py-2">
        <span
          class="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          :class="s.pr?.state === 'MERGED' ? 'bg-success/15 text-success' : train.next === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
          :title="s.pr?.state === 'MERGED' ? 'Merged' : train.next === s.id ? 'Ship this next' : hasOrder ? `Step ${s.n}` : 'No order set'"
        >
          {{ hasOrder ? s.n : '·' }}
        </span>
        <div class="min-w-0 flex-1">
          <PrRow v-if="s.pr" :pr="s.pr" compact class="min-w-0" :flags="flagsOf(s.id)">
            <template v-if="train.next === s.id" #badges><Badge variant="primary">Ship next</Badge></template>
          </PrRow>
          <RepoName v-else :id="s.id" class="font-mono text-sm" />
          <ul class="mt-0.5 space-y-0.5 pl-3 text-xs text-muted-foreground">
            <li v-for="l in s.after" :key="`a${l.from}`" class="flex items-center gap-1.5">
              <PhArrowBendDownRight :size="12" class="shrink-0" />after
              <button class="min-w-0 shrink font-mono text-primary hover:underline" @click="deck.selectedId = l.from"><RepoName :id="l.from" /></button>
              <span class="truncate">: {{ l.reasons.join('; ') }}</span>
            </li>
            <li v-for="l in s.shares" :key="`j${other(l, s.id)}`" class="flex items-center gap-1.5">
              <PhLinkSimple :size="12" class="shrink-0" />with
              <button class="min-w-0 shrink font-mono text-primary hover:underline" @click="deck.selectedId = other(l, s.id)"><RepoName :id="other(l, s.id)" /></button>
              <span class="truncate">: {{ l.reasons.join('; ') }}</span>
            </li>
          </ul>
        </div>
      </li>
    </ol>
  </Card>
</template>
