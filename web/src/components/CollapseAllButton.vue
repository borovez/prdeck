<script setup lang="ts">
import { PhArrowsInLineVertical, PhArrowsOutLineVertical } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'

/** Expand all / Collapse all for a page of collapsible groups */
defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <Button variant="outline" size="sm" @click="emit('toggle')">
    <PhArrowsOutLineVertical v-if="collapsed" /><PhArrowsInLineVertical v-else />
    {{ collapsed ? 'Expand all' : 'Collapse all' }}
  </Button>
</template>
