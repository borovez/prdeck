<script setup lang="ts">
import { computed } from 'vue'
import { PhFlag } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Feature flags (a PR's, or a release's roll-up) as a small flag icon with a count; the tooltip lists each
 * flag's state per environment. Green: on in the first environment for every flag; amber: some are off there.
 */
const props = defineProps<{ keys: string[] }>()
const deck = useDeck()
const flags = computed(() => props.keys.map((k) => ({ key: k, flag: deck.flagByKey.get(k) })))
const tone = computed(() => {
  const first = flags.value.map((f) => f.flag?.envs[0]?.on)
  if (first.some((x) => x === undefined)) return 'text-muted-foreground'
  return first.every(Boolean) ? 'text-success' : 'text-warning'
})
</script>

<template>
  <Tooltip v-if="keys.length">
    <TooltipTrigger as-child>
      <span class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums" :class="tone" @click.stop>
        <PhFlag :size="15" weight="fill" />{{ keys.length > 1 ? keys.length : '' }}
      </span>
    </TooltipTrigger>
    <TooltipContent class="max-w-sm">
      <div class="mb-0.5 font-medium">Feature flags</div>
      <div v-for="f in flags" :key="f.key" class="flex items-center gap-2 py-0.5">
        <span class="font-mono">{{ f.key }}</span>
        <span class="flex-1" />
        <template v-if="f.flag?.envs.length">
          <span v-for="e in f.flag.envs" :key="e.key" class="opacity-90">{{ e.key }} {{ e.on ? 'on' : 'off' }}</span>
        </template>
        <span v-else class="opacity-70">{{ f.flag?.error ?? (deck.overview?.configured.launchdarkly ? 'not synced yet' : 'LaunchDarkly not connected') }}</span>
      </div>
    </TooltipContent>
  </Tooltip>
</template>
