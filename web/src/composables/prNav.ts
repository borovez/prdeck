import { useEventListener } from '@vueuse/core'
import { LAYER_OPEN } from './escape'

/**
 * Arrow up/down moves the open PR to the previous/next PR on the page, in on-screen order.
 * Any visible element with `data-pr-id` counts (list rows, board cards, Jira rows, graph nodes), so
 * every view works without registering its list. A PR can appear more than once (dashboard panels,
 * Jira rows); the occurrence last clicked or navigated to is the starting point.
 */
export function usePrArrowNav(selected: () => string | null, select: (id: string) => void) {
  let cursor: HTMLElement | null = null

  useEventListener(document, 'click', (e) => {
    cursor = (e.target as HTMLElement).closest<HTMLElement>('[data-pr-id]')
  }, { capture: true })

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const id = selected()
    const target = e.target as HTMLElement
    if (!id || target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector(LAYER_OPEN)) return

    const items = [...document.querySelectorAll<HTMLElement>('[data-pr-id]')].filter((el) => el.offsetParent && !el.closest('[data-pr-drawer]'))
    let i = cursor && cursor.isConnected && cursor.dataset.prId === id ? items.indexOf(cursor) : -1
    if (i < 0) i = items.findIndex((el) => el.dataset.prId === id)
    const step = e.key === 'ArrowDown' ? 1 : -1
    // Skip neighbours that are the same PR (it can sit next to itself, e.g. in Jira rows)
    let j = i + step
    while (items[j] && items[j].dataset.prId === id) j += step
    const next = items[j]
    if (!next) return
    e.preventDefault()
    cursor = next
    select(next.dataset.prId!)
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
