<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { PhLockSimple, PhLockSimpleOpen, PhX } from '@phosphor-icons/vue'
import { useLayout } from '@/stores/layout'
import { LAYER_OPEN, onEscape } from '@/composables/escape'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Right-hand detail panel (PR, Slack message): resizable, closes on Escape and on a click outside
 * it unless "keep open" is on. Header, actions, body and footer are slots.
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const layout = useLayout()
onEscape(() => props.open && (emit('close'), true))

/** Clicks that shouldn't close it: other items (they switch the panel), and layers on top of it */
const KEEP_OPEN_TARGETS =
  '[data-side-panel], [data-pr-id], [data-slack-id], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-sonner-toaster], [data-reka-popper-content-wrapper]'
useEventListener(
  document,
  'pointerdown',
  (e: PointerEvent) => {
    if (!props.open || layout.prefs.panelPinned || e.button !== 0) return
    if ((e.target as HTMLElement).closest?.(KEEP_OPEN_TARGETS) || document.querySelector(LAYER_OPEN)) return
    emit('close')
  },
  { capture: true },
)

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
      <!-- z-30: the body's scroll area is positioned and would otherwise cover the handle below the header -->
      <div
        class="absolute inset-y-0 -left-1 z-30 w-2.5 cursor-col-resize transition-colors hover:bg-primary/30"
        title="Drag to resize"
        @mousedown="startResize"
      />
      <header class="flex items-start gap-2 border-b p-4">
        <div class="min-w-0 flex-1"><slot name="header" /></div>
        <slot name="actions" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-pressed="!!layout.prefs.panelPinned"
              :aria-label="layout.prefs.panelPinned ? 'Close when clicking outside' : 'Keep open when clicking outside'"
              @click="layout.prefs.panelPinned = !layout.prefs.panelPinned"
            >
              <PhLockSimple v-if="layout.prefs.panelPinned" weight="fill" class="text-primary" /><PhLockSimpleOpen v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ layout.prefs.panelPinned ? 'Kept open: click to close on outside clicks again' : 'Keep open when clicking outside' }}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')"><PhX /></Button>
      </header>
      <slot />
      <footer v-if="$slots.footer" class="flex flex-wrap items-center gap-2 border-t bg-background p-3">
        <slot name="footer" />
      </footer>
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
