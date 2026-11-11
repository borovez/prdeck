<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { PhCheck, PhCopy } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'

/** Monospace block with a copy button in the top-right corner. */
const props = defineProps<{ code: string }>()
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
</script>

<template>
  <div class="relative">
    <pre class="overflow-x-auto rounded-md bg-muted p-3 pr-11 text-xs whitespace-pre-wrap">{{ props.code }}</pre>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      class="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
      :aria-label="copied ? 'Copied' : 'Copy'"
      :title="copied ? 'Copied' : 'Copy'"
      @click="copy(props.code)"
    >
      <PhCheck v-if="copied" class="text-success" /><PhCopy v-else />
    </Button>
  </div>
</template>
