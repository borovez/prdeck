import type { ActionKind, Bucket, CheckState } from '@shared/types'

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'm'],
    [24, 'h'],
    [7, 'd'],
    [4.35, 'w'],
    [12, 'mo'],
    [Infinity, 'y'],
  ]
  let v = s / 60
  for (const [n, u] of units) {
    if (v < n) return `${Math.floor(v)}${u} ago`
    v /= n
  }
  return ''
}

export const shortId = (id: string) => {
  const [repo, n] = id.split('#')
  return `${repo.split('/')[1]}#${n}`
}

import type { BadgeVariants } from '@/components/ui/badge'
type Tone = NonNullable<BadgeVariants['variant']>

/** Badge variant per action – status colours come from the theme tokens (success/warning/info/destructive). */
export const ACTION_TONE: Record<ActionKind, Tone> = {
  review: 'primary',
  address_feedback: 'warning',
  resolve_conflicts: 'destructive',
  fix_ci: 'destructive',
  finish_draft: 'muted',
  merge: 'success',
  release: 'merged',
  wait_review: 'outline',
  wait_deps: 'warning',
  awaiting_release: 'info',
  none: 'outline',
  done: 'muted',
}

export const BUCKETS: { key: Bucket; label: string; hint: string }[] = [
  { key: 'action', label: 'Needs my action', hint: 'Reviews, CI, feedback, merges & releases on you' },
  { key: 'blocked', label: 'Blocked', hint: 'Waiting on a prerequisite PR to merge or release' },
  { key: 'waiting', label: 'Waiting on others', hint: 'In review, or merged and not yet released' },
  { key: 'watching', label: 'Watching', hint: 'Team PRs in tracked repos' },
]

export const CHECK_STYLE: Record<CheckState, { cls: string; label: string }> = {
  SUCCESS: { cls: 'text-success', label: 'Checks passing' },
  FAILURE: { cls: 'text-destructive', label: 'Checks failing' },
  ERROR: { cls: 'text-destructive', label: 'Checks errored' },
  PENDING: { cls: 'text-warning', label: 'Checks running' },
  EXPECTED: { cls: 'text-warning', label: 'Checks expected' },
  NONE: { cls: 'text-muted-foreground/40', label: 'No checks' },
}

export const jiraTone = (cat: string): Tone => (cat === 'done' ? 'success' : cat === 'indeterminate' ? 'info' : 'muted')
