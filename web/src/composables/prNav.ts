import { useEventListener } from '@vueuse/core'
import { LAYER_OPEN } from './escape'

/**
 * Arrow up/down moves an open side panel to the previous/next item on the page, in on-screen order.
 * Items are visible elements with `data-{kind}-id` (e.g. data-pr-id on PR rows, board cards, graph
 * nodes; data-slack-id on Slack rows), so views don't register their lists. An item can appear more
 * than once; the occurrence last clicked or navigated to is the starting point.
 */
/** Visible items of a kind in on-screen order, outside side panels */
const itemsOf = (attr: string) =>
  [...document.querySelectorAll<HTMLElement>(`[${attr}]`)].filter((el) => el.offsetParent && !el.closest('[data-side-panel]'))

/** The id after (or else before) `id` on screen, e.g. to move on once an item leaves the list */
export function neighbourId(kind: 'pr' | 'slack', id: string): string | null {
  const attr = `data-${kind}-id`
  const ids = [...new Set(itemsOf(attr).map((el) => el.getAttribute(attr)!))]
  const i = ids.indexOf(id)
  return i < 0 ? null : (ids[i + 1] ?? ids[i - 1] ?? null)
}

export function useArrowNav(kind: 'pr' | 'slack', selected: () => string | null, select: (id: string) => void) {
  const attr = `data-${kind}-id`
  const idOf = (el: HTMLElement) => el.getAttribute(attr)
  let cursor: HTMLElement | null = null

  useEventListener(document, 'click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(`[${attr}]`)
    if (el) cursor = el
  }, { capture: true })

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const id = selected()
    const target = e.target as HTMLElement
    if (!id || target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector(LAYER_OPEN)) return

    const items = itemsOf(attr)
    let i = cursor && cursor.isConnected && idOf(cursor) === id ? items.indexOf(cursor) : -1
    if (i < 0) i = items.findIndex((el) => idOf(el) === id)
    const step = e.key === 'ArrowDown' ? 1 : -1
    // Skip neighbours that are the same item (it can sit next to itself)
    let j = i + step
    while (items[j] && idOf(items[j]) === id) j += step
    const next = items[j]
    if (!next) return
    e.preventDefault()
    cursor = next
    select(idOf(next)!)
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
