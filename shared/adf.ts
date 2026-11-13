// Markdown -> Atlassian Document Format (Jira descriptions). Shared so the create dialog previews
// exactly what the server sends: headings, paragraphs, bullet/numbered lists, > quotes, code blocks,
// and inline **bold**, *italic* / _italic_, `code`, [links](url) and bare URLs.

/** Marks we write: strong, em, code, link. Jira's own documents also use strike, underline, textColor… */
export interface AdfMark {
  type: string
  attrs?: { href?: string; [k: string]: unknown }
}
export interface AdfNode {
  type: string
  text?: string
  marks?: AdfMark[]
  attrs?: { level?: number; url?: string; text?: string; shortName?: string; [k: string]: unknown }
  content?: AdfNode[]
}
export interface AdfDoc {
  type: 'doc'
  version: 1
  content: AdfNode[]
}

export function markdownToAdf(md: string): AdfDoc {
  const inline = (text: string): AdfNode[] => {
    const out: AdfNode[] = []
    // Bare URLs stop before trailing punctuation and closing brackets: "(see https://x.io/a)," links https://x.io/a
    // Italic needs a non-word character around it, so snake_case_names and 2*3*4 stay as they are
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|(?<![\w*])\*(?![\s*])[^*\n]*[^\s*]\*(?![\w*])|(?<!\w)_(?!\s)[^_\n]*[^\s_]_(?!\w))/g
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
      const t = m[0]
      if (t.startsWith('**')) out.push({ type: 'text', text: t.slice(2, -2), marks: [{ type: 'strong' }] })
      else if (t.startsWith('`')) out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'code' }] })
      else if (t.startsWith('*') || t.startsWith('_')) out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'em' }] })
      else if (t.startsWith('[')) {
        const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
        out.push({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
      } else out.push({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href: t } }] })
      last = m.index! + t.length
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
    return out.length ? out : [{ type: 'text', text: ' ' }]
  }
  const content: AdfNode[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith('```')) {
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] })
      continue
    }
    if (/^\s*>/.test(line)) {
      // A run of "> " lines is one quote; "> " on its own starts a new paragraph inside it
      const paras: string[][] = [[]]
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const q = lines[i].replace(/^\s*>\s?/, '')
        if (q.trim()) paras[paras.length - 1].push(q)
        else if (paras[paras.length - 1].length) paras.push([])
        i++
      }
      i--
      content.push({
        type: 'blockquote',
        content: paras.filter((p) => p.length).map((p) => ({ type: 'paragraph', content: inline(p.join(' ')) })),
      })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: inline(h[2]) })
      continue
    }
    const listRe = /^\s*([-*]|\d+\.)\s+(.*)$/
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: AdfNode[] = []
      while (i < lines.length && listRe.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(listRe.exec(lines[i])![2]) }] })
        i++
      }
      i--
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items })
      continue
    }
    const para = [line]
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*>|\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) para.push(lines[++i])
    content.push({ type: 'paragraph', content: inline(para.join(' ')) })
  }
  return { type: 'doc', version: 1, content }
}

/**
 * ADF → Markdown, for editing an existing Jira description in the composer. Covers what Jira's
 * editor writes for text: headings, paragraphs, lists (nested), quotes and panels, code blocks,
 * rules, tables (as pipe rows), mentions, emoji, smart links, and bold / italic / code / strike /
 * links. Media becomes a placeholder. The composer only sends the description back when you change
 * it, so anything lost here only matters for descriptions you edit.
 */
export function adfToMarkdown(doc: AdfDoc | null | undefined): string {
  if (!doc?.content) return ''
  const inline = (nodes: AdfNode[] = []): string =>
    nodes
      .map((n) => {
        if (n.type === 'hardBreak') return '\n'
        if (n.type === 'mention') return `@${String(n.attrs?.text ?? '').replace(/^@/, '')}`
        if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
        if (n.type === 'inlineCard' || n.type === 'blockCard') return String(n.attrs?.url ?? '')
        if (n.type === 'status') return `[${String(n.attrs?.text ?? '')}]`
        if (n.type === 'date') return new Date(Number(n.attrs?.timestamp)).toISOString().slice(0, 10)
        if (n.type !== 'text') return inline(n.content)
        let t = n.text ?? ''
        const marks = n.marks ?? []
        const link = marks.find((m) => m.type === 'link')?.attrs?.href
        if (marks.some((m) => m.type === 'code')) t = `\`${t}\``
        else {
          if (marks.some((m) => m.type === 'strong')) t = `**${t}**`
          if (marks.some((m) => m.type === 'em')) t = `*${t}*`
          if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`
        }
        return link && link !== n.text ? `[${t}](${link})` : t
      })
      .join('')

  const block = (n: AdfNode, indent = ''): string => {
    switch (n.type) {
      case 'paragraph':
        return indent + inline(n.content).replace(/\n/g, `\n${indent}`)
      case 'heading':
        return `${'#'.repeat(Number(n.attrs?.level ?? 1))} ${inline(n.content)}`
      case 'bulletList':
      case 'orderedList':
        return (n.content ?? [])
          .map((item, i) => {
            const bullet = n.type === 'orderedList' ? `${i + 1}. ` : '- '
            const [first, ...rest] = item.content ?? []
            const head = first ? block(first).trimStart() : ''
            const tail = rest.map((c) => block(c, indent + '  ')).join('\n')
            return `${indent}${bullet}${head}${tail ? `\n${tail}` : ''}`
          })
          .join('\n')
      case 'codeBlock':
        return `${indent}\`\`\`${n.attrs?.language ?? ''}\n${inline(n.content)}\n${indent}\`\`\``
      case 'blockquote':
      case 'panel':
        return (n.content ?? []).map((c) => block(c).replace(/^/gm, '> ')).join('\n>\n')
      case 'rule':
        return '---'
      case 'table':
        return (n.content ?? [])
          .map((row, r) => {
            const cells = (row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c)).join(' ').replace(/\|/g, '\\|'))
            const line = `| ${cells.join(' | ')} |`
            return r === 0 ? `${line}\n|${cells.map(() => ' --- |').join('')}` : line
          })
          .join('\n')
      case 'mediaSingle':
      case 'mediaGroup':
        return '[attachment]'
      case 'expand':
      case 'nestedExpand':
        return [n.attrs?.title ? `**${n.attrs.title}**` : '', ...(n.content ?? []).map((c) => block(c, indent))].filter(Boolean).join('\n\n')
      default:
        return n.content ? n.content.map((c) => block(c, indent)).join('\n\n') : inline([n])
    }
  }
  return doc.content.map((n) => block(n)).join('\n\n').trim()
}
