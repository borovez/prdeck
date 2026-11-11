import type { ReleaseInfo } from './types.ts'

/**
 * Plain wording for a merged PR's release state. `via` says how the repo releases: a GitHub
 * release/tag (vp3.2.0) or a branch it gets promoted to (master).
 */
export function releaseStatus(r: ReleaseInfo): { short: string; long: string } {
  const branch = r.via === 'branch'
  if (r.released)
    return branch
      ? { short: `In ${r.ref}`, long: `Released: merged into ${r.ref}` }
      : { short: `In ${r.ref}`, long: r.ref ? `Released in ${r.ref}` : 'Released' }
  if (!r.ref) return { short: 'Not released yet', long: 'Not released yet' }
  return branch
    ? { short: `Not in ${r.ref} yet`, long: `Not released yet: not merged into ${r.ref} yet` }
    : { short: `Not in ${r.ref} yet`, long: `Not released yet: the latest release, ${r.ref}, doesn't include it` }
}
