import type { DependencyKind, GithubAccount, PrId } from '../../shared/types.ts'
import { getPrBody, updatePrBody } from './github.ts'
import { normaliseRef, parseBodyBlocks, parseBodyDependencies } from './refs.ts'

/** The line written for a dependency; parseBodyDependencies reads it back */
const lineFor = (ref: string, kind: DependencyKind) => (kind === 'release' ? `Requires release of: ${ref}` : `Depends on: ${ref}`)
const DEP_LINE = /^[\s>*-]*(?:\*\*)?\s*((?:requires|needs|after|waits?\s+(?:on|for))\s+release(?:\s+of)?|depends\s+on|blocked\s+by|requires|needs)\s*(?:\*\*)?\s*:?/i
const REF = /(https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|[\w.-]+\/[\w.-]+#\d+|#\d+)/g

/** Body with `to` listed as a dependency of the given kind (unchanged if it already is) */
export function withDependency(body: string, repo: string, self: PrId, to: PrId, toRef: string, kind: DependencyKind): string {
  const existing = parseBodyDependencies(body, repo, self).find((d) => d.to === to)
  if (existing?.kind === kind) return body
  const base = existing ? withoutDependency(body, repo, to) : body
  return `${base.replace(/\s+$/, '')}\n\n${lineFor(toRef, kind)}\n`
}

/** Body with every mention of `to` removed from dependency lines; lines left without refs go */
export function withoutDependency(body: string, repo: string, to: PrId): string {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const m = DEP_LINE.exec(line)
    if (!m) {
      out.push(line)
      continue
    }
    const refs = [...line.matchAll(REF)].map((r) => r[1])
    const keep = refs.filter((r) => normaliseRef(r, repo) !== to)
    if (keep.length === refs.length) out.push(line)
    else if (keep.length) out.push(`${line.slice(0, m[0].length).trimEnd()} ${keep.join(', ')}`)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Edit the PR's description on GitHub, starting from its current text; returns the new body */
export async function editDescription(account: GithubAccount, repo: string, number: number, edit: (body: string) => string): Promise<string | null> {
  const current = await getPrBody(account, repo, number)
  const next = edit(current)
  if (next === current) return null
  await updatePrBody(account, repo, number, next)
  return next
}

const BLOCKS_LINE = /^[\s>*-]*(?:\*\*)?\s*(release\s+blocks|blocks)\s*(?:\*\*)?\s*:?/i

/** Prerequisite's side: body with "Blocks: <dependent>" (or "Release blocks:"), unchanged if already there */
export function withBlocks(body: string, repo: string, self: PrId, dependent: PrId, dependentRef: string, kind: DependencyKind): string {
  const existing = parseBodyBlocks(body, repo, self).find((d) => d.from === dependent)
  if (existing?.kind === kind) return body
  const base = existing ? withoutBlocks(body, repo, dependent) : body
  return `${base.replace(/\s+$/, '')}\n\n${kind === 'release' ? 'Release blocks' : 'Blocks'}: ${dependentRef}\n`
}

/** Prerequisite's side: every mention of `dependent` taken out of its "Blocks:" lines */
export function withoutBlocks(body: string, repo: string, dependent: PrId): string {
  return stripRef(body, repo, dependent, BLOCKS_LINE)
}

function stripRef(body: string, repo: string, id: PrId, lineRe: RegExp): string {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const m = lineRe.exec(line)
    if (!m || !m[0].trim()) {
      out.push(line)
      continue
    }
    const refs = [...line.matchAll(REF)].map((r) => r[1])
    const keep = refs.filter((r) => normaliseRef(r, repo) !== id)
    if (keep.length === refs.length) out.push(line)
    else if (keep.length) out.push(`${line.slice(0, m[0].length).trimEnd()} ${keep.join(', ')}`)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
