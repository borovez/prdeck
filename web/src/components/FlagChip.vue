<script setup lang="ts">
import { computed } from 'vue'
import { PhFlag } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** One feature flag as a chip: green when on in the first environment, muted when off or unknown; opens LaunchDarkly */
const props = defineProps<{ flagKey: string }>()
const deck = useDeck()
const flag = computed(() => deck.flagByKey.get(props.flagKey))
const on = computed(() => flag.value?.envs[0]?.on)
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <a
        :href="flag?.url"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs"
        :class="on === true ? 'bg-success/12 text-success' : on === false ? 'bg-warning/12 text-warning' : 'bg-muted text-muted-foreground'"
        @click.stop
      >
        <PhFlag :size="12" weight="fill" />{{ flagKey }}
      </a>
    </TooltipTrigger>
    <TooltipContent>
      <template v-if="flag?.envs.length">
        <div v-for="e in flag.envs" :key="e.key">{{ e.key }}: {{ e.on ? 'on' : 'off' }}</div>
      </template>
      <span v-else>{{ flag?.error ?? (deck.overview?.configured.launchdarkly ? 'Not synced yet' : 'LaunchDarkly not connected') }}</span>
    </TooltipContent>
  </Tooltip>
</template>
