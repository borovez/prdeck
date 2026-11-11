/**
 * Ordering for Jira statuses and priorities, most in need of attention first. Status names vary per
 * workflow, so they're matched by keywords; anything unrecognised falls back to Jira's category.
 */

const STATUS_RULES: [RegExp, number][] = [
  [/block|impediment/i, 0],
  [/need|clarif|question|waiting for (info|input)/i, 1],
  [/progress|doing|develop|implement/i, 2],
  [/review/i, 3],
  [/\bqa\b|test|verif/i, 4],
  // After code review, in pipeline order
  [/merged|into dev/i, 5],
  [/pre-?prod|staging|uat/i, 5.1],
  [/beta/i, 5.2],
  [/release|deploy/i, 5.3],
  [/to ?do|backlog|open|new|selected|ready for dev/i, 6],
  [/hold|paused|parked|later/i, 7],
  [/done|closed|resolved|complete|shipped/i, 8],
  [/drop|won'?t|cancel|reject|duplicate|invalid/i, 9],
]
const CATEGORY_RANK: Record<string, number> = { indeterminate: 4.5, new: 6, done: 8 }

export function statusRank(status: string, category: string): number {
  for (const [re, rank] of STATUS_RULES) if (re.test(status)) return rank
  return CATEGORY_RANK[category] ?? 6.5
}

const PRIORITY_RULES: [RegExp, number][] = [
  [/blocker|highest|critical|urgent|p0/i, 0],
  [/high|major|p1/i, 1],
  [/medium|normal|p2/i, 2],
  [/lowest|trivial|p4/i, 4],
  [/low|minor|p3/i, 3],
]
export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 5
  for (const [re, rank] of PRIORITY_RULES) if (re.test(priority)) return rank
  return 2.5
}
