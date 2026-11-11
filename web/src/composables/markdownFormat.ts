/**
 * Markdown formatting on a textarea selection. Edits go through insertText so the browser's undo
 * history works (one Cmd+Z per action) and `input` fires for v-model. Applying a format to text
 * that already has it removes it.
 */

/** Replace a range, keeping undo history; falls back to setting the value */
function replace(el: HTMLTextAreaElement, start: number, end: number, text: string) {
  el.focus()
  el.setSelectionRange(start, end)
  if (!document.execCommand('insertText', false, text)) {
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** Wrap the selection in markers (**, _, `), or unwrap it if it's already wrapped */
export function toggleWrap(el: HTMLTextAreaElement, marker: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e)
  const n = marker.length
  if (value.slice(s - n, s) === marker && value.slice(e, e + n) === marker) {
    replace(el, s - n, e + n, selected)
    el.setSelectionRange(s - n, e - n)
    return
  }
  if (selected.length > 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    replace(el, s, e, selected.slice(n, -n))
    el.setSelectionRange(s, e - 2 * n)
    return
  }
  // Keep surrounding spaces outside the markers: "**word** " not "**word **"
  const lead = selected.match(/^\s*/)![0]
  const trail = selected.match(/\s*$/)![0]
  const inner = selected.trim() || placeholder
  replace(el, s, e, `${lead}${marker}${inner}${marker}${trail}`)
  const at = s + lead.length + n
  el.setSelectionRange(at, at + inner.length)
}

/** [selection](url) with "url" selected, ready to paste over */
export function insertLink(el: HTMLTextAreaElement) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const label = value.slice(s, e).trim() || 'link text'
  replace(el, s, e, `[${label}](url)`)
  const at = s + label.length + 3
  el.setSelectionRange(at, at + 3)
}

/** Toggle a prefix on every line the selection touches: "- ", "1. ", "> " */
export function toggleLinePrefix(el: HTMLTextAreaElement, kind: 'bullet' | 'number' | 'quote') {
  const { selectionStart: s, selectionEnd: e, value } = el
  const start = value.lastIndexOf('\n', s - 1) + 1
  const endNl = value.indexOf('\n', e === s ? e : e - 1)
  const end = endNl === -1 ? value.length : endNl
  const lines = value.slice(start, end).split('\n')
  const has = { bullet: /^- /, number: /^\d+\. /, quote: /^> ?/ }[kind]
  const all = lines.every((l) => has.test(l) || !l.trim())
  const out = lines.map((l, i) => {
    if (!l.trim()) return l
    if (all) return l.replace(has, '')
    const bare = l.replace(/^(- |\d+\. |> ?)/, '')
    return kind === 'bullet' ? `- ${bare}` : kind === 'number' ? `${i + 1}. ${bare}` : `> ${bare}`
  })
  const text = out.join('\n')
  replace(el, start, end, text)
  el.setSelectionRange(start, start + text.length)
}
