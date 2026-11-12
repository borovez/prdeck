<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowDown, PhArrowUp, PhCircleNotch, PhTrash } from '@phosphor-icons/vue'
import type { DepEdge, PrView, ReleaseTrain } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useDependencies } from '@/composables/dependencies'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import RepoName from './RepoName.vue'
import PrPicker from './PrPicker.vue'
import FlagStatus from './FlagStatus.vue'
import { useReleaseFlags } from '@/composables/flags'

/**
 * A release's place in its release train (PR panel): the train in order, and for every other release how it
 * relates to this one, with buttons to set the order. Setting it adds a merge dependency between the two
 * release PRs (written into the waiting PR's description when that setting is on).
 */
const props = defineProps<{ train: ReleaseTrain; releaseId: string }>()
const deck = useDeck()
const deps = useDependencies()
const busy = deps.busy
const flagsOf = useReleaseFlags()

const ordered = computed(() => props.train.links.some((l) => l.kind === 'order'))
const others = computed(() =>
  props.train.releases
    .filter((r) => r !== props.releaseId)
    .map((r) => {
      const before = props.train.links.find((l) => l.kind === 'order' && l.from === r && l.to === props.releaseId)
      const after = props.train.links.find((l) => l.kind === 'order' && l.from === props.releaseId && l.to === r)
      const shared = props.train.links.find((l) => l.kind === 'jira' && [l.from, l.to].includes(r) && [l.from, l.to].includes(props.releaseId))
      // A direct dependency between the two release PRs can be removed here; ones from their contents can't
      const direct: DepEdge | undefined =
        deck.byId.get(props.releaseId)?.dependsOn.find((e) => e.to === r) ?? deck.byId.get(r)?.dependsOn.find((e) => e.to === props.releaseId)
      const link = before ?? after
      // Why: set directly between the two release PRs, else the reason about this release's own PRs
      const why = direct
        ? direct.source === 'body'
          ? 'set in the PR description'
          : 'added in PR Deck'
        : (link?.reasons.find((x) => x.includes(props.releaseId)) ?? link?.reasons[0] ?? '')
      return { id: r, pr: deck.byId.get(r), before, after, shared, direct, why }
    }),
)

const order = (waiting: string, first: string) => deps.add(waiting, first, 'merge')
const remove = (e: DepEdge) => deps.remove(e)

// Order against any open release, also outside the train
const otherRelease = ref('')
const isRelease = (p: PrView) => p.flow === 'release' && p.state === 'OPEN'
const orderedReason = (p: PrView) =>
  props.train.links.some((l) => l.kind === 'order' && [l.from, l.to].includes(p.id) && [l.from, l.to].includes(props.releaseId))
    ? 'already ordered'
    : null
async function shipAfterPicked() {
  if (otherRelease.value && (await order(props.releaseId, otherRelease.value))) otherRelease.value = ''
}
</script>

<template>
  <div class="space-y-3">
    <!-- The train in order -->
    <ol class="flex flex-wrap items-center gap-1 text-xs">
      <li v-for="(id, i) in train.releases" :key="id" class="flex items-center gap-1">
        <span v-if="i" class="text-muted-foreground">{{ ordered ? '→' : '·' }}</span>
        <button
          class="flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent"
          :class="id === releaseId ? 'border-primary bg-primary/10' : ''"
          @click="deck.selectedId = id"
        >
          <span v-if="ordered" class="font-semibold tabular-nums">{{ i + 1 }}.</span>
          <RepoName :id="id" class="max-w-48 font-mono" />
          <FlagStatus :keys="flagsOf(id)" class="[&_svg]:size-3" />
          <Badge v-if="deck.byId.get(id)?.state === 'MERGED'" variant="merged" class="h-4 px-1 text-[10px]">merged</Badge>
          <Badge v-else-if="train.next === id" variant="primary" class="h-4 px-1 text-[10px]">ship next</Badge>
        </button>
      </li>
    </ol>
    <p v-if="!ordered" class="text-xs text-muted-foreground">
      No shipping order yet: these releases ship the same Jira issues. Choose below which goes first.
    </p>

    <!-- Each other release relative to this one -->
    <ul class="divide-y rounded-lg border">
      <li v-for="o in others" :key="o.id" class="space-y-1.5 px-3 py-2 text-sm">
        <div class="flex min-w-0 items-center gap-2">
          <button class="min-w-0 font-mono text-primary hover:underline" @click="deck.selectedId = o.id"><RepoName :id="o.id" /></button>
          <span class="min-w-0 truncate text-xs text-muted-foreground">{{ o.pr?.title }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <template v-if="o.before">
            <Badge variant="info"><PhArrowUp />Ships before this one</Badge>
            <span class="min-w-0 truncate text-muted-foreground" :title="o.before.reasons.join('\n')">{{ o.why }}</span>
          </template>
          <template v-else-if="o.after">
            <Badge variant="info"><PhArrowDown />Ships after this one</Badge>
            <span class="min-w-0 truncate text-muted-foreground" :title="o.after.reasons.join('\n')">{{ o.why }}</span>
          </template>
          <template v-else>
            <Badge variant="muted">No order</Badge>
            <span v-if="o.shared" class="min-w-0 truncate text-muted-foreground">{{ o.shared.reasons.join('; ') }}</span>
          </template>
          <span class="flex-1" />
          <template v-if="!o.before && !o.after && deck.byId.get(releaseId)?.state === 'OPEN'">
            <Button
              size="xs"
              variant="outline"
              :disabled="busy"
              :title="`Adds “Depends on: ${o.id}” to this release's description`"
              @click="order(releaseId, o.id)"
            >
              <PhCircleNotch v-if="deps.isPending(releaseId, o.id)" class="animate-spin" />Ship this after it
            </Button>
            <Button
              v-if="o.pr?.state === 'OPEN'"
              size="xs"
              variant="outline"
              :disabled="busy"
              :title="`Adds “Depends on: ${releaseId}” to ${o.id}'s description`"
              @click="order(o.id, releaseId)"
            >
              <PhCircleNotch v-if="deps.isPending(o.id, releaseId)" class="animate-spin" />Ship this before it
            </Button>
          </template>
          <Button
            v-else-if="o.direct && (o.before || o.after)"
            size="xs"
            variant="ghost"
            :disabled="busy"
            :title="o.direct.source === 'body' ? 'Takes the line out of the PR description' : 'Removes the dependency'"
            @click="remove(o.direct)"
          >
            <PhCircleNotch v-if="deps.isPending(o.direct.from, o.direct.to)" class="animate-spin" /><PhTrash v-else />Remove order
          </Button>
        </div>
      </li>
    </ul>

    <!-- Order against a release that isn't in the train yet -->
    <form v-if="deck.byId.get(releaseId)?.state === 'OPEN'" class="flex items-center gap-2" @submit.prevent="shipAfterPicked">
      <PrPicker
        v-model="otherRelease"
        :exclude="releaseId"
        :filter="isRelease"
        :disabled-reason="orderedReason"
        :disabled="busy"
        placeholder="Ship this after another release… (search open releases)"
        class="h-8 min-w-0 flex-1"
      />
      <Button type="submit" size="sm" variant="outline" :disabled="busy || !otherRelease">
        <PhCircleNotch v-if="busy" class="animate-spin" /> Ship after it
      </Button>
    </form>
  </div>
</template>
