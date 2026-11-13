import type { PrId } from '../../shared/types.ts'
import { parseBodyBlocks, parseBodyDependencies, parseFeatureFlags } from './refs.ts'

/**
 * Lines a rewrite must not lose: every dependency ("Depends on", "Requires release of", "Blocks",
 * "Release blocks") and feature flag the current description declares. A line of the old description
 * whose references aren't all in the new one is appended to it as it was. Returns the new body and the
 * lines put back.
 */
export function keepDeclarations(oldBody: string, newBody: string, repo: string, self: PrId): { body: string; kept: string[] } {
  const deps = (b: string) => new Set(parseBodyDependencies(b, repo, self).map((d) => `${d.kind}:${d.to}`))
  const blocks = (b: string) => new Set(parseBodyBlocks(b, repo, self).map((d) => `${d.kind}:${d.from}`))
  const flags = (b: string) => new Set(parseFeatureFlags(b))
  const now = { deps: deps(newBody), blocks: blocks(newBody), flags: flags(newBody) }
  const kept: string[] = []
  for (const line of oldBody.split('\n')) {
    if (!line.trim()) continue
    const missing =
      [...deps(line)].some((x) => !now.deps.has(x)) || [...blocks(line)].some((x) => !now.blocks.has(x)) || [...flags(line)].some((x) => !now.flags.has(x))
    if (missing && !kept.includes(line)) kept.push(line)
  }
  if (!kept.length) return { body: newBody, kept }
  // A new line whose references are all in a restored line is replaced by it (no "Depends on" twice)
  const refsOf = (line: string) => [...[...deps(line)].map((x) => `dep:${x}`), ...[...blocks(line)].map((x) => `blocks:${x}`), ...[...flags(line)].map((f) => `flag:${f}`)]
  const restored = new Set(kept.flatMap(refsOf))
  const body = newBody
    .split('\n')
    .filter((line) => {
      const refs = refsOf(line)
      return !refs.length || !refs.every((r) => restored.has(r))
    })
    .join('\n')
  return { body: `${body.trimEnd()}\n\n${kept.join('\n')}\n`, kept }
}
