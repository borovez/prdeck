import { toast } from 'vue-sonner'
import type { DepEdge, DependencyKind } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

/**
 * Add / remove dependencies. With "write to description" on (Settings), the server edits the dependent PR's
 * description on GitHub; if that fails the dependency is kept in PR Deck only, and the toast says why.
 */
export function useDependencies() {
  const deck = useDeck()

  async function add(from: string, to: string, kind: DependencyKind): Promise<boolean> {
    let res: Awaited<ReturnType<typeof api.addDep>> | undefined
    const ok = await deck.mutate(async () => void (res = await api.addDep(from, to, kind)))
    if (!ok || !res) return false
    if (res.written) toast.success('Dependency added to the PR description', { description: from })
    else if (res.error) toast.warning('Dependency saved in PR Deck only', { description: `Couldn't edit the description of ${from}: ${res.error}` })
    else toast.success('Dependency added')
    return true
  }

  /** Manual ones are deleted here; ones from the description are taken out of it on GitHub */
  const canRemove = (e: DepEdge) => e.id != null || e.source === 'body'
  function remove(e: DepEdge): Promise<boolean> {
    if (e.id != null) return deck.mutate(() => api.removeDep(e.id!), 'Dependency removed')
    return deck.mutate(() => api.removeDepFromDescription(e.from, e.to), `Removed from the description of ${e.from}`)
  }

  return { add, remove, canRemove }
}
