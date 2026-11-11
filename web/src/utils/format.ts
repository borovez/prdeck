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

/** "a, b ,c" → ["a", "b", "c"] */
export const splitList = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** Plain deep copy of reactive data (structuredClone rejects Vue proxies) */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Relative date bucket for grouping lists: Today, Yesterday, This week, Last week, then "October 2026" */
export function dateGroup(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 14) return 'Last week'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** "Tue 4 Nov 2026, 14:05" for tooltips */
export const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
