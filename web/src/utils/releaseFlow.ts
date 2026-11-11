import type { PrView } from '@shared/types'

/** Branches work is integrated on before a release (mirrors server/src/flow.ts) */
export const INTEGRATION_BRANCHES = ['dev', 'develop', 'development', 'staging']

export const FLOW_LABEL = { release: 'Release', hotfix: 'Hotfix', backmerge: 'Backmerge' } as const

/** Merged into dev (or similar) and not part of any release PR yet: what the next release will ship */
export const isUnreleased = (p: PrView) =>
  p.state === 'MERGED' && !p.flow && INTEGRATION_BRANCHES.includes(p.baseRef.toLowerCase()) && p.shipsIn.length === 0 && !p.release?.released

export const VIA_LABEL = {
  commit: 'Found in the release commits',
  'cherry-pick': 'Cherry-picked into the release branch',
  description: 'Referenced in the release description',
} as const
