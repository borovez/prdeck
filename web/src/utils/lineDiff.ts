export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap'
  text: string
}

/**
 * Line diff (LCS) for reviewing a rewritten description: unchanged runs longer than `context` lines
 * on each side of a change collapse to one "gap" line.
 */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // Long texts: compare without the LCS table (rare for issue descriptions)
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (out.push({ kind: 'same', text: a[i] }), i++, j++)
    // Removed lines before added ones, like git
    else if (j < b.length && (i >= a.length || lcs[i][j + 1] > lcs[i + 1][j])) out.push({ kind: 'add', text: b[j++] })
    else out.push({ kind: 'del', text: a[i++] })
  }
  // Collapse long unchanged runs
  const keep = out.map((l, k) => l.kind !== 'same' || out.slice(Math.max(0, k - context), k + context + 1).some((x) => x.kind !== 'same'))
  const shown: DiffLine[] = []
  out.forEach((l, k) => {
    if (keep[k]) shown.push(l)
    else if (shown.at(-1)?.kind !== 'gap') shown.push({ kind: 'gap', text: '' })
  })
  return shown
}
