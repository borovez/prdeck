<script setup lang="ts">
import { PhCaretDown, PhCaretRight } from '@phosphor-icons/vue'

/** Header of a collapsible section: caret, uppercase label, and extras (counts, status) in the slot */
defineProps<{ label: string }>()
const open = defineModel<boolean>('open', { default: true })
</script>

<template>
  <button type="button" class="flex min-w-0 items-center gap-1.5 text-left" :aria-expanded="open" @click="open = !open">
    <PhCaretDown v-if="open" :size="12" class="text-muted-foreground" /><PhCaretRight v-else :size="12" class="text-muted-foreground" />
    <h3 class="text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase">{{ label }}</h3>
    <slot />
  </button>
</template>
