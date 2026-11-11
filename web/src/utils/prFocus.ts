import type { PrView } from '@shared/types'

/**
 * Quick filters on the PR page, opened from the dashboard tiles. Each matches exactly what its
 * tile counts on the server (model.ts stats), so the list and the number agree.
 */
export const PR_FOCUS = {
  action: { label: 'Needs my action', match: (p: PrView) => p.bucket === 'action' },
  review: { label: 'Review requests', match: (p: PrView) => p.action.kind === 'review' },
  blocked: { label: 'Blocked', match: (p: PrView) => p.bucket === 'blocked' },
  mine: { label: 'My open PRs', match: (p: PrView) => p.isMine && p.state === 'OPEN' },
  threads: { label: 'Unresolved conversations', match: (p: PrView) => p.isMine && p.state === 'OPEN' && p.unresolvedThreads > 0 },
} satisfies Record<string, { label: string; match: (p: PrView) => boolean }>

export type PrFocus = keyof typeof PR_FOCUS
