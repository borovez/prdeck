<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { Badge } from '@/components/ui/badge'

/** Active filters shown as removable chips next to a toolbar */
defineProps<{ chips: { key: string; label: string; clear: () => void }[] }>()
</script>

<template>
  <Badge v-for="c in chips" :key="c.key" variant="primary" class="h-7 gap-1 pr-1 text-xs">
    {{ c.label }}
    <button type="button" class="rounded p-0.5 hover:bg-primary/15" :aria-label="`Clear ${c.label}`" @click="c.clear()"><PhX /></button>
  </Badge>
</template>
