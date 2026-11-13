import { getSettings } from './db.ts'
import { repoFile } from './github.ts'
import { accountForOwner } from './sync.ts'

const cache = new Map<string, { at: number; text: Promise<string | null> }>()
const MAX_AGE_MS = 60 * 60_000
const WHOLE_FILE_LIMIT = 8000

/**
 * What a repo's CLAUDE.md says about writing issues: the sections whose heading mentions Jira,
 * issues or tickets (with their sub-sections). A short file is used whole (it describes the
 * project, which helps too); a long one without such sections gives its opening only.
 * Read from the default branch, kept an hour.
 */
export function claudeMdGuide(repo: string): Promise<string | null> {
  const key = repo.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.text
  const text = (async () => {
    const accounts = getSettings().github.accounts.filter((a) => a.token)
    const acc = accountForOwner(accounts, repo.split('/')[0])
    if (!acc) return null
    const md = await repoFile(acc, repo, 'CLAUDE.md')
    return md ? issueSections(md) : null
  })()
  cache.set(key, { at: Date.now(), text })
  text.catch(() => cache.delete(key))
  return text
}

export function issueSections(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let keepLevel = 0 // inside a kept section of this heading level
  let inFence = false
  for (const line of lines) {
    if (line.startsWith('```')) inFence = !inFence
    const h = !inFence && /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      if (keepLevel && level <= keepLevel) keepLevel = 0
      if (!keepLevel && /\b(jira|issues?|tickets?|stor(y|ies)|bugs?)\b/i.test(h[2])) keepLevel = level
    }
    if (keepLevel) out.push(line)
  }
  if (out.length) return out.join('\n').trim()
  if (md.length <= WHOLE_FILE_LIMIT) return md.trim()
  return `${md.slice(0, 3000).trim()}\n…`
}
