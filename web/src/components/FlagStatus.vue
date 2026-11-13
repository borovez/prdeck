<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowSquareOut, PhFlag } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { useFlagPrs } from '@/composables/flags'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import PrListPopover from './PrListPopover.vue'

/**
 * Feature flags (a PR's, or a release's roll-up) as a small flag icon with a count. Hover card: each flag with its
 * LaunchDarkly link, state per environment and a chip of the PRs that name it.
 * Green: on in the first environment for every flag; amber: some are off there.
 */
const props = defineProps<{ keys: string[] }>()
const deck = useDeck()
const flagPrs = useFlagPrs()
const flags = computed(() => props.keys.map((k) => ({ key: k, flag: deck.flagByKey.get(k), prs: flagPrs(k) })))
const tone = computed(() => {
  const first = flags.value.map((f) => f.flag?.envs[0]?.on)
  if (first.some((x) => x === undefined)) return 'text-muted-foreground'
  return first.every(Boolean) ? 'text-success' : 'text-warning'
})
const iconTone = (on: boolean | undefined) => (on === true ? 'text-success' : on === false ? 'text-warning' : 'text-muted-foreground')
const unknown = (f: (typeof flags.value)[number]) =>
  f.flag?.error ?? (deck.overview?.configured.launchdarkly ? 'Not synced yet' : 'LaunchDarkly not connected')

// The card stays open while a PRs list opened from it is open (that list is outside the card)
const hover = ref(false)
const nested = ref(false)
function onNested(v: boolean) {
  nested.value = v
  if (!v) hover.value = false
}
</script>

<template>
  <HoverCard v-if="keys.length" :open="hover || nested" :open-delay="150" :close-delay="150" @update:open="(v: boolean) => (hover = v)">
    <HoverCardTrigger as-child>
      <button
        type="button"
        class="nodrag nopan flex shrink-0 items-center gap-0.5 rounded text-xs tabular-nums hover:opacity-80"
        :class="tone"
        :aria-label="`${keys.length} feature flag${keys.length === 1 ? '' : 's'}`"
        @click.stop="hover = true"
      >
        <PhFlag :size="15" weight="fill" />{{ keys.length > 1 ? keys.length : '' }}
      </button>
    </HoverCardTrigger>
    <HoverCardContent align="end" class="w-96 p-0" @click.stop>
      <div class="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <PhFlag :size="13" weight="fill" />Feature flags
        <span class="tabular-nums">· {{ keys.length }}</span>
      </div>
      <div class="divide-y">
        <div v-for="f in flags" :key="f.key" class="space-y-1.5 px-3 py-2.5">
          <div class="flex min-w-0 items-start gap-2">
            <PhFlag :size="14" weight="fill" :class="cn('mt-0.5 shrink-0', iconTone(f.flag?.envs[0]?.on))" />
            <div class="min-w-0 flex-1">
              <a
                v-if="f.flag?.url"
                :href="f.flag.url"
                target="_blank"
                rel="noopener"
                class="flex min-w-0 items-center gap-1 font-mono text-sm break-all hover:underline"
              >
                {{ f.key }}<PhArrowSquareOut :size="12" class="shrink-0 text-muted-foreground" />
              </a>
              <span v-else class="font-mono text-sm break-all">{{ f.key }}</span>
              <div v-if="f.flag && f.flag.name !== f.key" class="truncate text-xs text-muted-foreground">{{ f.flag.name }}</div>
            </div>
            <PrListPopover v-if="f.prs.length" compact :ids="f.prs" :placeholder="`Go to a PR using ${f.key}…`" @open="onNested" />
          </div>
          <div class="flex flex-wrap gap-1 pl-[22px]">
            <template v-if="f.flag?.envs.length">
              <Badge
                v-for="e in f.flag.envs"
                :key="e.key"
                :variant="e.on ? 'success' : 'muted'"
                :title="e.lastModified ? `Changed ${timeAgo(e.lastModified)}` : undefined"
              >
                {{ e.key }} · {{ e.on ? 'on' : 'off' }}
              </Badge>
            </template>
            <span v-else class="text-xs text-muted-foreground">{{ unknown(f) }}</span>
            <Badge v-if="f.flag?.temporary" variant="outline">temporary</Badge>
            <Badge v-if="f.flag?.archived" variant="muted">archived</Badge>
          </div>
        </div>
      </div>
    </HoverCardContent>
  </HoverCard>
</template>
