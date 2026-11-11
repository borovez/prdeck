import type { PrFlow, PrId, PrRecord } from '../../shared/types.ts'

/** Branches work is integrated on before a release, and branches that represent production */
export const INTEGRATION_BRANCHES = ['dev', 'develop', 'development', 'staging']
export const RELEASE_BRANCHES = ['master', 'main', 'production', 'prod']
const isIntegration = (b: string) => INTEGRATION_BRANCHES.includes(b.toLowerCase())
const isRelease = (b: string) => RELEASE_BRANCHES.includes(b.toLowerCase())

/** Per repo: the integration branch it uses (most PRs target it), or null for trunk-based repos */
export function integrationBranches(prs: PrRecord[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const pr of prs) {
    for (const b of [pr.baseRef, pr.headRef, pr.defaultBranch])
      if (b && isIntegration(b)) {
        const m = counts.get(pr.repo.toLowerCase()) ?? new Map()
        m.set(b, (m.get(b) ?? 0) + 1)
        counts.set(pr.repo.toLowerCase(), m)
      }
  }
  return new Map([...counts].map(([repo, m]) => [repo, [...m].sort((a, b) => b[1] - a[1])[0][0]]))
}

/** Is this PR a release, a hotfix or a backmerge? Null for ordinary feature PRs. */
export function prFlow(pr: Pick<PrRecord, 'repo' | 'baseRef' | 'headRef' | 'title'>, integration: Map<string, string>): PrFlow | null {
  const base = pr.baseRef
  const head = pr.headRef
  const usesIntegration = integration.has(pr.repo.toLowerCase())
  if (isRelease(base)) {
    if (isRelease(head)) return null
    if (isIntegration(head) || /^release[/-]/i.test(head) || (usesIntegration && /^release\b/i.test(pr.title))) return 'release'
    if (usesIntegration || /^(hotfix|warmfix)[/-]/i.test(head)) return 'hotfix'
    return null
  }
  if (isIntegration(base) && (isRelease(head) || /^back-?merge[/-]/i.test(head) || /\bback-?merge\b/i.test(pr.title))) return 'backmerge'
  return null
}

export const isReleaseItemCandidate = (head: string, base: string) =>
  !isIntegration(head) && !isRelease(head) && !isRelease(base)

export type FlowMap = Map<PrId, PrFlow | null>
