<script setup lang="ts">
import { PhCircleNotch, PhMagicWand, PhSparkle, PhStop } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'

/**
 * The purple "Ask Claude" card: a prompt (Enter submits), the action button (Stop while writing, with a
 * light running around the border), and slots for context chips and what Claude answered.
 * Images pasted or dropped on it are the parent's to handle (it carries data-ai-images).
 */
const props = defineProps<{
  drafting: boolean
  /** Claude is set up */
  ready: boolean
  placeholder: string
  action: string
}>()
const prompt = defineModel<string>({ required: true })
const emit = defineEmits<{ submit: []; stop: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (props.ready && !props.drafting && prompt.value.trim()) emit('submit')
  }
}
</script>

<template>
  <div
    data-ai-images
    :class="{ 'ai-writing': drafting }"
    class="rounded-lg border border-primary/30 bg-linear-to-br from-primary/12 via-primary/6 to-merged/12 shadow-[0_0_24px_-12px_var(--primary)] transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:shadow-[0_0_28px_-10px_var(--primary)]"
  >
    <div class="flex items-start gap-2 px-3 pt-2.5">
      <PhSparkle class="mt-1 size-4 shrink-0 text-primary" :class="{ 'animate-pulse': drafting }" weight="fill" />
      <textarea
        v-model="prompt"
        rows="1"
        :readonly="drafting"
        :disabled="!ready"
        :placeholder="ready ? placeholder : 'Set up Claude in Settings to use it here'"
        class="field-sizing-content max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-primary/60 disabled:opacity-60"
        @keydown="onKey"
      />
      <Button v-if="drafting" size="sm" variant="outline" class="h-8 shrink-0 gap-1.5 border-primary/40 px-3" title="Stop Claude" @click="emit('stop')">
        <PhCircleNotch class="animate-spin text-primary" /> Writing… <PhStop weight="fill" class="text-destructive" /> Stop
      </Button>
      <Button
        v-else
        size="sm"
        class="h-8 shrink-0 gap-1.5 bg-linear-to-r from-primary to-merged px-3.5 font-semibold text-white shadow-[0_2px_12px_-2px_var(--primary)] hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
        :disabled="!ready || !prompt.trim()"
        :title="!prompt.trim() ? 'Type what Claude should write or change' : 'Enter'"
        @click="emit('submit')"
      >
        <PhMagicWand weight="fill" /> {{ action }}
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-2.5">
      <slot name="context" />
    </div>
    <slot />
  </div>
</template>
