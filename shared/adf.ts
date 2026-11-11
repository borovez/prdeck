// Markdown -> Atlassian Document Format (Jira descriptions). Shared so the create dialog previews
// exactly what the server sends: headings, paragraphs, bullet/numbered lists, code blocks, and inline
// **bold**, `code`, [links](url) and bare URLs.

export interface AdfMark {
  type: 'strong' | 'code' | 'link'
  attrs?: { href: string }
}
export interface AdfNode {
  type: string
  text?: string
  marks?: AdfMark[]
  attrs?: { level?: number }
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
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
      const t = m[0]
      if (t.startsWith('**')) out.push({ type: 'text', text: t.slice(2, -2), marks: [{ type: 'strong' }] })
      else if (t.startsWith('`')) out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'code' }] })
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
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) para.push(lines[++i])
    content.push({ type: 'paragraph', content: inline(para.join(' ')) })
  }
  return { type: 'doc', version: 1, content }
}
