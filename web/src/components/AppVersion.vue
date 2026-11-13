<script setup lang="ts">
import { computed } from 'vue'
import { useUpdates } from '@/composables/updates'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** The running version beside the app name; a dot when a newer release is out. Click: check now (or open the update) */
const { status, checking, popoverOpen, load } = useUpdates()
const tip = computed(() => {
  const s = status.value
  if (!s) return 'Checking the version…'
  if (s.available) return `PR Deck ${s.latest} is available (you have ${s.current}). Click for what’s new.`
  return `PR Deck ${s.current}${s.checkedAt ? ', the latest release' : ''}. Click to check for updates.`
})
const click = () => (status.value?.available ? (popoverOpen.value = true) : load(true))
</script>

<template>
  <Tooltip v-if="status">
    <TooltipTrigger as-child>
      <button
        type="button"
        class="relative rounded-md px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        :aria-label="tip"
        @click="click"
      >
        <span :class="{ 'animate-pulse': checking }">v{{ status.current }}</span>
        <span v-if="status.available" class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
      </button>
    </TooltipTrigger>
    <TooltipContent side="right">{{ tip }}</TooltipContent>
  </Tooltip>
</template>
