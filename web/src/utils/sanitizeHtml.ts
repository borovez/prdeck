/**
 * Allowlist HTML sanitizer for GitHub's rendered markdown (already sanitized by GitHub; this is the
 * second layer before v-html). Unknown elements are unwrapped (their text kept), dangerous ones are
 * dropped with their content, only a few attributes survive, and URLs must be http(s)/mailto/#.
 */
const ALLOWED = new Set(
  'a abbr b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img input ins kbd li ol p pre q s samp small span strong sub summary sup table tbody td tfoot th thead tr tt u ul'.split(' '),
)
const DROP = new Set('script style iframe object embed form button select textarea template svg math link meta base video audio source'.split(' '))
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  input: ['type', 'checked', 'disabled'],
  td: ['align', 'colspan', 'rowspan'],
  th: ['align', 'colspan', 'rowspan'],
  ol: ['start'],
  details: ['open'],
}
const SAFE_URL = /^(https?:|mailto:|#)/i

function clean(node: Node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove()
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (DROP.has(tag)) {
      el.remove()
      continue
    }
    clean(el)
    if (!ALLOWED.has(tag)) {
      el.replaceWith(...el.childNodes)
      continue
    }
    const keep = ATTRS[tag] ?? []
    for (const a of [...el.attributes]) {
      const ok = keep.includes(a.name) && !((a.name === 'href' || a.name === 'src') && !SAFE_URL.test(a.value.trim()))
      if (!ok) el.removeAttribute(a.name)
    }
    if (tag === 'input' && el.getAttribute('type') !== 'checkbox') el.remove()
    if (tag === 'input') el.setAttribute('disabled', '')
    if (tag === 'a' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
  }
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  clean(doc.body)
  return doc.body.innerHTML
}
