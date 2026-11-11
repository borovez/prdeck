<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { AlertVariants } from '.'
import { ref } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { alertVariants } from '.'

/** closable: show an X that hides the alert and emits `close` (parents can use it to clear their state). */
const props = defineProps<{
  class?: HTMLAttributes['class']
  variant?: AlertVariants['variant']
  closable?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const open = ref(true)

function close() {
  open.value = false
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    data-slot="alert"
    :data-closable="closable || undefined"
    :class="cn(alertVariants({ variant }), props.class)"
    role="alert"
  >
    <slot />
    <button
      v-if="closable"
      type="button"
      aria-label="Dismiss"
      class="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      @click="close"
    >
      <PhX class="size-4" />
    </button>
  </div>
</template>
