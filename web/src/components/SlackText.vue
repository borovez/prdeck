<script setup lang="ts">
import { h, type VNode } from 'vue'

/**
 * Renders Slack mrkdwn (links, mentions, *bold*, _italic_, ~strike~, `code`, ``` blocks, > quotes)
 * as Vue elements, never as HTML strings. Without `rich` (older items) it shows the plain text.
 */
const props = defineProps<{ text: string; rich?: string | null }>()

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const SAFE_URL = /^(https?:|mailto:)/i

/** <…> tokens: links, user/channel mentions, broadcasts */
function token(body: string): VNode | string {
  const [target, label] = body.split('|', 2) as [string, string | undefined]
  const chip = (t: string) => h('span', { class: 'rounded bg-primary/12 px-1 font-medium text-primary' }, t)
  if (target.startsWith('@')) return chip(`@${label ?? target.slice(1)}`)
  if (target.startsWith('#')) return chip(`#${label ?? target.slice(1)}`)
  if (target.startsWith('!subteam')) return chip(label ?? '@group')
  if (target.startsWith('!')) return chip(`@${target.slice(1)}`)
  if (!SAFE_URL.test(target)) return decode(label ?? target)
  const shown = decode(label ?? target.replace(/^mailto:/, ''))
  return h('a', { href: target, target: '_blank', rel: 'noopener', class: 'text-primary underline underline-offset-2 break-all', onClick: (e: Event) => e.stopPropagation() }, shown)
}

/** Inline markup; styles nest (e.g. a link inside bold) */
const INLINE = /<([^>\n]+)>|`([^`\n]+)`|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)|(?<!\w)~([^~\n]+)~(?!\w)/g
function inline(s: string): (VNode | string)[] {
  const out: (VNode | string)[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(decode(s.slice(last, m.index)))
    if (m[1] !== undefined) out.push(token(m[1]))
    else if (m[2] !== undefined) out.push(h('code', { class: 'rounded bg-muted px-1 font-mono text-[0.9em]' }, decode(m[2])))
    else if (m[3] !== undefined) out.push(h('strong', { class: 'font-semibold' }, inline(m[3])))
    else if (m[4] !== undefined) out.push(h('em', inline(m[4])))
    else if (m[5] !== undefined) out.push(h('s', inline(m[5])))
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(decode(s.slice(last)))
  return out
}

/** Code blocks, then quote runs, then paragraphs (line breaks kept) */
function blocks(src: string): VNode[] {
  const out: VNode[] = []
  src.split(/```/).forEach((part, i) => {
    if (i % 2) {
      out.push(h('pre', { class: 'my-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap' }, decode(part.replace(/^\n|\n$/g, ''))))
      return
    }
    let para: string[] = []
    let quote: string[] = []
    const flush = () => {
      if (para.length) out.push(h('span', { class: 'block whitespace-pre-wrap' }, inline(para.join('\n'))))
      if (quote.length) out.push(h('blockquote', { class: 'my-1 border-l-2 border-border pl-2 text-muted-foreground whitespace-pre-wrap' }, inline(quote.join('\n'))))
      para = []
      quote = []
    }
    for (const line of part.split('\n')) {
      const q = /^(&gt;|>)\s?/.exec(line)
      if (q) {
        if (para.length) flush()
        quote.push(line.slice(q[0].length))
      } else {
        if (quote.length) flush()
        para.push(line)
      }
    }
    flush()
  })
  return out
}

const render = () =>
  props.rich ? h('div', { class: 'break-words' }, blocks(props.rich.trim())) : h('div', { class: 'break-words whitespace-pre-line' }, props.text)
</script>

<template>
  <render />
</template>
