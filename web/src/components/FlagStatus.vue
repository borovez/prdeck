<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowSquareOut, PhFlag } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { useFlagPrs } from '@/composables/flags'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import PrListPopover from './PrListPopover.vue'

/**
 * Feature flags (a PR's, or a release's roll-up) as a small flag icon with a count. Hover: each flag's state per
 * environment. Click: the same as a popover, with each flag's PRs chip (the PRs whose description names it).
 * Green: on in the first environment for every flag; amber: some are off there.
 */
const props = defineProps<{ keys: string[] }>()
const deck = useDeck()
const flagPrs = useFlagPrs()
const flags = computed(() => props.keys.map((k) => ({ key: k, flag: deck.flagByKey.get(k) })))
const tone = computed(() => {
  const first = flags.value.map((f) => f.flag?.envs[0]?.on)
  if (first.some((x) => x === undefined)) return 'text-muted-foreground'
  return first.every(Boolean) ? 'text-success' : 'text-warning'
})
const unknown = (f: (typeof flags.value)[number]) =>
  f.flag?.error ?? (deck.overview?.configured.launchdarkly ? 'not synced yet' : 'LaunchDarkly not connected')
</script>

<template>
  <Popover v-if="keys.length">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="nodrag nopan flex shrink-0 items-center rounded text-xs tabular-nums hover:opacity-80"
        :class="tone"
        @click.stop
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="flex items-center gap-0.5"><PhFlag :size="15" weight="fill" />{{ keys.length > 1 ? keys.length : '' }}</span>
          </TooltipTrigger>
          <TooltipContent class="max-w-sm">
            <div class="mb-0.5 font-medium">Feature flags</div>
            <div v-for="f in flags" :key="f.key" class="flex items-center gap-2 py-0.5">
              <span class="font-mono">{{ f.key }}</span>
              <span class="flex-1" />
              <template v-if="f.flag?.envs.length">
                <span v-for="e in f.flag.envs" :key="e.key" class="opacity-90">{{ e.key }} {{ e.on ? 'on' : 'off' }}</span>
              </template>
              <span v-else class="opacity-70">{{ unknown(f) }}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-max max-w-[32rem] gap-1 p-2" @click.stop @open-auto-focus.prevent>
      <div class="px-1 pb-1 text-xs font-medium text-muted-foreground">Feature flags</div>
      <div v-for="f in flags" :key="f.key" class="flex items-center gap-2 rounded-md px-1 py-1 text-xs whitespace-nowrap">
        <PhFlag
          :size="13"
          weight="fill"
          :class="f.flag?.envs[0]?.on === true ? 'text-success' : f.flag?.envs[0]?.on === false ? 'text-warning' : 'text-muted-foreground'"
        />
        <a v-if="f.flag?.url" :href="f.flag.url" target="_blank" rel="noopener" class="flex items-center gap-1 font-mono hover:underline">
          {{ f.key }}<PhArrowSquareOut :size="11" class="text-muted-foreground" />
        </a>
        <span v-else class="font-mono">{{ f.key }}</span>
        <span class="flex-1" />
        <template v-if="f.flag?.envs.length">
          <span v-for="e in f.flag.envs" :key="e.key" :class="e.on ? 'text-success' : 'text-muted-foreground'">{{ e.key }} {{ e.on ? 'on' : 'off' }}</span>
        </template>
        <span v-else class="text-muted-foreground">{{ unknown(f) }}</span>
        <PrListPopover compact :ids="flagPrs(f.key)" :placeholder="`Go to a PR using ${f.key}…`" />
      </div>
    </PopoverContent>
  </Popover>
</template>
