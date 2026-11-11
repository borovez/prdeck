<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { useLayout } from '@/stores/layout'
import { onEscape } from '@/composables/escape'
import { Button } from '@/components/ui/button'

/** Right-hand detail panel (PR, Slack message): resizable, closes on Escape. Header and body are slots. */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const layout = useLayout()
onEscape(() => props.open && (emit('close'), true))

function startResize(ev: MouseEvent) {
  const startX = ev.clientX
  const startW = layout.prefs.drawerWidth
  const onMove = (e: MouseEvent) => (layout.prefs.drawerWidth = Math.min(1100, Math.max(380, startW + startX - e.clientX)))
  const onUp = () => (window.removeEventListener('mousemove', onMove), window.removeEventListener('mouseup', onUp))
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  ev.preventDefault()
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="open"
      data-side-panel
      class="fixed inset-y-0 right-0 z-40 flex max-w-full flex-col border-l bg-background shadow-2xl"
      :style="{ width: layout.prefs.drawerWidth + 'px' }"
    >
      <div class="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/30" title="Drag to resize" @mousedown="startResize" />
      <header class="flex items-start gap-2 border-b p-4">
        <div class="min-w-0 flex-1"><slot name="header" /></div>
        <slot name="actions" />
        <Button variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')"><PhX /></Button>
      </header>
      <slot />
    </aside>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.18s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
