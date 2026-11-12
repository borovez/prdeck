import { useDeck } from '@/stores/deck'

/** Feature flags of a release: its own and those of the synced PRs it ships */
export function useReleaseFlags() {
  const deck = useDeck()
  return (releaseId: string): string[] => {
    const own = deck.byId.get(releaseId)?.flags ?? []
    const shipped = (deck.releaseById.get(releaseId)?.items ?? []).flatMap((i) => deck.byId.get(i.id)?.flags ?? [])
    return [...new Set([...own, ...shipped])]
  }
}
