import { computed, reactive } from 'vue'
import { toast } from 'vue-sonner'
import type { DepEdge, DependencyKind } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

/** Writes in flight, shared by every caller ("from>to"), so the same dependency isn't written twice at once */
const pending = reactive(new Set<string>())

/**
 * Add / remove dependencies. With "write to description" on (Settings), the server edits the dependent PR's
 * description on GitHub; if that fails the dependency is kept in PR Deck only, and the toast says why.
 * One write per pair at a time; adding one that already exists does nothing.
 */
export function useDependencies() {
  const deck = useDeck()
  const keyOf = (from: string, to: string) => `${from}>${to}`
  /** Any dependency write running (for disabling add / remove controls) */
  const busy = computed(() => pending.size > 0)
  const isPending = (from: string, to: string) => pending.has(keyOf(from, to))

  async function add(from: string, to: string, kind: DependencyKind): Promise<boolean> {
    const key = keyOf(from, to)
    if (pending.has(key)) return false
    const existing = deck.overview?.edges.find((e) => e.from === from && e.to === to)
    if (existing && existing.kind === kind) {
      toast.info('That dependency already exists', { description: `${from} already waits for ${to}` })
      return false
    }
    pending.add(key)
    try {
      let res: Awaited<ReturnType<typeof api.addDep>> | undefined
      const ok = await deck.mutate(async () => void (res = await api.addDep(from, to, kind)))
      if (!ok || !res) return false
      const where = [res.written && from, res.writtenOther && to].filter(Boolean).join(' and ')
      if (where && !res.error) toast.success(res.written && res.writtenOther ? 'Dependency added to both PR descriptions' : 'Dependency added to the PR description', { description: where })
      else if (where) toast.warning(`Dependency added to ${where}`, { description: `Couldn't edit the other description: ${res.error}` })
      else if (res.error) toast.warning('Dependency saved in PR Deck only', { description: `Couldn't edit the descriptions: ${res.error}` })
      else toast.success('Dependency added')
      return true
    } finally {
      pending.delete(key)
    }
  }

  /** Manual ones are deleted here; ones from the description are taken out of it on GitHub */
  const canRemove = (e: DepEdge) => e.id != null || e.source === 'body'
  async function remove(e: DepEdge): Promise<boolean> {
    const key = keyOf(e.from, e.to)
    if (pending.has(key)) return false
    pending.add(key)
    try {
      if (e.id != null) return await deck.mutate(() => api.removeDep(e.id!), 'Dependency removed')
      return await deck.mutate(() => api.removeDepFromDescription(e.from, e.to), 'Removed from the PR descriptions')
    } finally {
      pending.delete(key)
    }
  }

  return { add, remove, canRemove, busy, isPending }
}
