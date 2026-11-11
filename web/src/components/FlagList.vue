<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowSquareOut, PhFlag } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { Badge } from '@/components/ui/badge'

/** Feature flags (PR panel): state per environment, read only, with a link to LaunchDarkly */
const props = defineProps<{ keys: string[] }>()
const deck = useDeck()
const connected = computed(() => !!deck.overview?.configured.launchdarkly)
const rows = computed(() => props.keys.map((k) => ({ key: k, flag: deck.flagByKey.get(k) })))
</script>

<template>
  <div class="space-y-1.5">
    <div v-for="{ key, flag } in rows" :key="key" class="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <PhFlag :size="15" weight="fill" :class="flag?.envs[0] ? (flag.envs[0].on ? 'text-success' : 'text-muted-foreground') : 'text-muted-foreground'" />
      <a v-if="flag" :href="flag.url" target="_blank" rel="noopener" class="font-mono hover:underline" :title="flag.name">
        {{ key }} <PhArrowSquareOut :size="12" class="inline text-muted-foreground" />
      </a>
      <span v-else class="font-mono">{{ key }}</span>
      <span v-if="flag && flag.name !== key" class="min-w-0 truncate text-xs text-muted-foreground">{{ flag.name }}</span>
      <Badge v-if="flag?.archived" variant="muted">archived</Badge>
      <Badge v-if="flag?.temporary" variant="outline" title="Marked temporary in LaunchDarkly: remove it once rolled out">temporary</Badge>
      <span class="flex-1" />
      <template v-if="flag?.envs.length">
        <Badge
          v-for="e in flag.envs"
          :key="e.key"
          :variant="e.on ? 'success' : 'muted'"
          :title="e.lastModified ? `Changed ${timeAgo(e.lastModified)}` : undefined"
        >
          {{ e.key }} · {{ e.on ? 'on' : 'off' }}
        </Badge>
      </template>
      <span v-else class="text-xs text-muted-foreground">
        {{ flag?.error ?? (connected ? 'Not synced yet' : 'Connect LaunchDarkly in Settings to see its state') }}
      </span>
    </div>
  </div>
</template>
