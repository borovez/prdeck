<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card-action"
    :class="cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-auto max-sm:mt-2 max-sm:justify-self-start', props.class)"
  >
    <slot />
  </div>
</template>
