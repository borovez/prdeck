import { getSettings } from './db.ts'
import { repoFile } from './github.ts'
import { accountForOwner } from './sync.ts'

const cache = new Map<string, { at: number; text: Promise<string | null> }>()
const MAX_AGE_MS = 60 * 60_000
const WHOLE_FILE_LIMIT = 8000

/**
 * What a repo's CLAUDE.md says about writing issues or PRs: the sections whose heading is about it
 * (Jira, issues, tickets; or pull requests, commits, deployment, dependencies, flags) with their sub-sections. A short file is used whole (it describes the
 * project, which helps too); a long one without such sections gives its opening only.
 * Read from the default branch, kept an hour.
 */
/** Section headings that matter for each kind of writing */
const TOPICS = {
  issue: /\b(jira|issues?|tickets?|stor(y|ies)|bugs?)\b/i,
  pr: /\b(pull[ -]?requests?|PRs?|commits?|deploy(ment)?s?|releases?|dependenc(y|ies)|feature flags?|jira)\b/i,
}

export function claudeMdGuide(repo: string, kind: keyof typeof TOPICS = 'issue'): Promise<string | null> {
  const key = `${repo.toLowerCase()}:${kind}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.text
  const text = (async () => {
    const accounts = getSettings().github.accounts.filter((a) => a.token)
    const acc = accountForOwner(accounts, repo.split('/')[0])
    if (!acc) return null
    const md = await repoFile(acc, repo, 'CLAUDE.md')
    return md ? sectionsAbout(md, TOPICS[kind]) : null
  })()
  cache.set(key, { at: Date.now(), text })
  text.catch(() => cache.delete(key))
  return text
}

export function sectionsAbout(md: string, topic: RegExp): string {
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
      if (!keepLevel && topic.test(h[2])) keepLevel = level
    }
    if (keepLevel) out.push(line)
  }
  if (out.length) return out.join('\n').trim()
  if (md.length <= WHOLE_FILE_LIMIT) return md.trim()
  return `${md.slice(0, 3000).trim()}\n…`
}
