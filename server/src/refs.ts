import type { DependencyKind, PrId } from '../../shared/types.ts'

/** Normalise "Owner/Repo#12" → "owner/repo#12" so ids match across sources. */
export const prId = (repo: string, number: number): PrId => `${repo.toLowerCase()}#${number}`

export function parsePrId(id: string): { owner: string; name: string; number: number } | null {
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(id.trim())
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : null
}

/** Accepts "owner/repo#12", a GitHub PR URL, or "#12" (relative to currentRepo). */
export function normaliseRef(ref: string, currentRepo?: string): PrId | null {
  ref = ref.trim()
  let m = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i.exec(ref)
  if (m) return prId(`${m[1]}/${m[2]}`, Number(m[3]))
  m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ref)
  if (m) return prId(`${m[1]}/${m[2]}`, Number(m[3]))
  m = /^#(\d+)$/.exec(ref)
  if (m && currentRepo) return prId(currentRepo, Number(m[1]))
  return null
}

const REF = String.raw`(https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|[\w.-]+\/[\w.-]+#\d+|#\d+)`

/**
 * Dependency conventions recognised in PR descriptions (case-insensitive, one per line or comma separated):
 *   Depends on: org/repo#12, https://github.com/org/repo/pull/34
 *   Blocked by #56
 *   Requires release of org/api#78       (→ waits for the prerequisite to be released)
 *   After release: org/api#78
 */
export function parseBodyDependencies(
  body: string,
  currentRepo: string,
  selfId: PrId,
): { to: PrId; kind: DependencyKind }[] {
  const out = new Map<PrId, DependencyKind>()
  // Release phrasings come first: alternation takes the first match, and plain "requires" would otherwise win
  const lineRe = /^[\s>*-]*(?:\*\*)?\s*((?:requires|needs|after|waits?\s+(?:on|for))\s+release(?:\s+of)?|depends\s+on|blocked\s+by|requires|needs)\s*(?:\*\*)?\s*:?\s*(.+)$/gim
  for (const m of body.matchAll(lineRe)) {
    const kind: DependencyKind = /release/i.test(m[1]) ? 'release' : 'merge'
    for (const r of m[2].matchAll(new RegExp(REF, 'g'))) {
      const id = normaliseRef(r[1], currentRepo)
      if (id && id !== selfId) {
        // a 'release' mention wins over a plain 'merge' one
        if (out.get(id) !== 'release') out.set(id, kind)
      }
    }
  }
  return [...out].map(([to, kind]) => ({ to, kind }))
}

/**
 * The other side of a dependency, written in the prerequisite's description:
 *   Blocks: org/web#12            (org/web#12 waits for this PR's merge)
 *   Release blocks: org/web#12    (org/web#12 waits for this PR's release)
 */
export function parseBodyBlocks(body: string, currentRepo: string, selfId: PrId): { from: PrId; kind: DependencyKind }[] {
  const out = new Map<PrId, DependencyKind>()
  const lineRe = /^[\s>*-]*(?:\*\*)?\s*(release\s+blocks|blocks)\s*(?:\*\*)?\s*:\s*(.+)$/gim
  for (const m of body.matchAll(lineRe)) {
    const kind: DependencyKind = /release/i.test(m[1]) ? 'release' : 'merge'
    for (const r of m[2].matchAll(new RegExp(REF, 'g'))) {
      const id = normaliseRef(r[1], currentRepo)
      if (id && id !== selfId && out.get(id) !== 'release') out.set(id, kind)
    }
  }
  return [...out].map(([from, kind]) => ({ from, kind }))
}

/** Jira keys like PROJ-123 from title / branch / body. */
export function extractJiraKeys(texts: (string | null | undefined)[], projectKeys: string[]): string[] {
  const allowed = new Set(projectKeys.map((k) => k.toUpperCase()))
  const keys = new Set<string>()
  for (const t of texts) {
    if (!t) continue
    for (const m of t.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})(?![A-Za-z0-9])/g)) {
      const project = m[1].toUpperCase()
      // branches are often lowercase (proj-123-fix) – accept those only for known projects
      if (m[1] !== project && !allowed.has(project)) continue
      if (allowed.size && !allowed.has(project)) continue
      if (['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'ES', 'GPT', 'PHP', 'V'].includes(project)) continue
      keys.add(`${project}-${Number(m[2])}`)
    }
  }
  return [...keys]
}

/**
 * Feature flags named in a PR description (case-insensitive):
 *   Feature flag: new-checkout            Flags: a, b
 *   **Flag:** `new-checkout` (new; …)     → only the `backticked` keys when a line has any
 * Prose with a qualifier: "behind the `new-checkout` LaunchDarkly flag", "feature flags `a` / `b`".
 * LaunchDarkly flag links anywhere (…/projects/<project>/flags/<key> or …/<project>/<env>/features/<key>).
 */
export function parseFeatureFlags(body: string | null | undefined): string[] {
  if (!body) return []
  const keys = new Set<string>()
  const KEY = /^[A-Za-z0-9][\w.-]{1,99}$/
  const add = (k: string) => {
    k = k.replace(/[.,;:]+$/, '')
    if (KEY.test(k) && !/^(none|n\/?a|no|yes|tbd)$/i.test(k)) keys.add(k)
  }
  // The colon is required ("Flag:", "**Flag:**", "**Flag**:"), so sentences like "feature flag changes." don't match
  const lineRe = /^[\s>*-]*(?:\*\*)?\s*(?:feature[ -]?flags?|ld[ -]?flags?|launch ?darkly(?: flags?)?|flags?)\s*(?::\s*\*\*|\*\*\s*:|:)\s*(.+)$/gim
  for (const m of body.matchAll(lineRe)) {
    const rest = m[1]
    const ticked = [...rest.matchAll(/`([^`]+)`/g)].map((t) => t[1].trim())
    if (ticked.length) ticked.forEach(add)
    // No backticks: only entries that are a single word ("a, b"), not prose
    else for (const part of rest.split(',')) if (!/\s/.test(part.trim())) add(part.trim())
  }
  // `key` LaunchDarkly flag / `key` feature flag / `key` LD flag
  for (const m of body.matchAll(/`([\w.-]+)`\s+(?:launch ?darkly|ld|feature)\s+flags?\b/gi)) add(m[1])
  // feature flag(s) / LaunchDarkly flag(s) `a`, `b` / `c`
  for (const m of body.matchAll(/(?:feature|launch ?darkly|ld)\s+flags?\s+((?:`[\w.-]+`(?:\s*(?:,|\/|and|or)\s*)?)+)/gi))
    for (const t of m[1].matchAll(/`([\w.-]+)`/g)) add(t[1])
  for (const m of body.matchAll(/launchdarkly\.com\/(?:projects\/[\w.-]+\/flags|[\w.-]+\/[\w.-]+\/features)\/([\w.-]+)/gi)) add(m[1])
  return [...keys]
}
