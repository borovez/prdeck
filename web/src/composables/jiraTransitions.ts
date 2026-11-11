import { api } from '@/api'
import type { JiraIssueView } from '@shared/types'

type Transition = Awaited<ReturnType<typeof api.transitions>>[number]

/**
 * Jira transitions, cached. They come from the workflow, so issues of the same project, type and
 * status share one list. Entries live 30 minutes or until the next sync (clearTransitions).
 */
const TTL = 30 * 60_000
const cache = new Map<string, { at: number; list: Promise<Transition[]> }>()

const keyFor = (issueKey: string, issue?: JiraIssueView) =>
  issue ? `${issueKey.split('-')[0]}|${issue.type}|${issue.status}` : issueKey

export function transitionsFor(issueKey: string, issue?: JiraIssueView): Promise<Transition[]> {
  const key = keyFor(issueKey, issue)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  const list = api.transitions(issueKey)
  cache.set(key, { at: Date.now(), list })
  list.catch(() => cache.delete(key)) // don't cache failures
  return list
}

export const clearTransitions = () => cache.clear()
