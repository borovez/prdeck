import { useEventListener } from '@vueuse/core'

/** A reka-ui dialog, menu or listbox is open on top: it owns the keyboard. */
export const LAYER_OPEN =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]'

/**
 * Escape closes custom panels (drawer, graph edge panel). `fn` returns whether it closed something;
 * the first one that does wins. Runs in the capture phase so a reka-ui dialog or menu that is still
 * open on top is seen and left to handle its own Escape.
 */
export function onEscape(fn: () => boolean) {
  useEventListener(
    window,
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector(LAYER_OPEN)) return
      if (fn()) e.preventDefault()
    },
    { capture: true },
  )
}
