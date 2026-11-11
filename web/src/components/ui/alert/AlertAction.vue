<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="alert-action"
    :class="cn('absolute top-1/2 right-3 -translate-y-1/2 group-data-closable/alert:right-11', props.class)"
  >
    <slot />
  </div>
</template>
