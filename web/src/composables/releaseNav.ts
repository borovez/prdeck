import { useRouter } from 'vue-router'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'

/**
 * Jump from a panel to the Releases page or the release graph, focused on a release / PR
 * (the page reads ?focus=<pr id>: expands, scrolls and highlights; the graph zooms to the box).
 */
export function useReleaseNav() {
  const router = useRouter()
  const deck = useDeck()
  const layout = useLayout()
  const releases = layout.view('releases', { tab: 'releases' as string })
  const graph = layout.view('releaseGraph', { repo: '' as string })

  function openReleases(focus: string, tab: 'releases' | 'hotfixes' = 'releases') {
    releases.tab = tab
    router.push({ path: '/releases', query: { focus } })
  }
  function openGraph(focus: string, repo: string) {
    releases.tab = 'graph'
    graph.repo = repo.toLowerCase()
    // Panels would cover the box the graph zooms to
    deck.selectedId = null
    deck.selectedJiraKey = null
    router.push({ path: '/releases', query: { focus } })
  }
  function openTrains() {
    releases.tab = 'trains'
    router.push('/releases')
  }

  /** The release that ships a Jira issue: open ones first */
  function releaseForIssue(key: string): string | null {
    const prs = deck.prs.filter((p) => p.jiraKeys.includes(key))
    const own = prs.find((p) => p.flow === 'release' && p.state === 'OPEN') ?? prs.find((p) => p.flow === 'release')
    if (own) return own.id
    const shipped = prs.flatMap((p) => p.shipsIn).sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN'))[0]
    if (shipped) return shipped.id
    const byContents = (deck.overview?.releases ?? [])
      .filter((r) => r.jiraKeys.includes(key))
      .sort((a, b) => Number(deck.byId.get(b.prId)?.state === 'OPEN') - Number(deck.byId.get(a.prId)?.state === 'OPEN'))[0]
    return byContents?.prId ?? null
  }

  return { openReleases, openGraph, openTrains, releaseForIssue }
}
