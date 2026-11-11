<script setup lang="ts">
import { h, type VNode } from 'vue'
import type { AdfDoc, AdfNode } from '@shared/adf'

/**
 * Renders an Atlassian Document Format doc with Vue elements, never HTML strings: what we send to
 * Jira, and Jira's own descriptions/comments (tables, mentions, cards, rules; images as a placeholder).
 */
const props = defineProps<{ doc: AdfDoc }>()
const SAFE_URL = /^(https?:|mailto:)/i

function text(n: AdfNode): VNode | string {
  let el: VNode | string = n.text ?? ''
  for (const m of n.marks ?? []) {
    if (m.type === 'strong') el = h('strong', { class: 'font-semibold' }, [el])
    else if (m.type === 'em') el = h('em', [el])
    else if (m.type === 'strike') el = h('s', [el])
    else if (m.type === 'underline') el = h('u', [el])
    else if (m.type === 'code') el = h('code', { class: 'rounded bg-muted px-1 font-mono text-[0.9em]' }, [el])
    else if (m.type === 'link' && m.attrs?.href && SAFE_URL.test(m.attrs.href))
      el = h('a', { href: m.attrs.href, target: '_blank', rel: 'noopener', class: 'text-primary underline underline-offset-2 break-all' }, [el])
  }
  return el
}

const HEADING = ['', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm']
function node(n: AdfNode): VNode | string {
  const kids = () => (n.content ?? []).map(node)
  switch (n.type) {
    case 'text':
      return text(n)
    case 'paragraph':
      return h('p', { class: 'my-2' }, kids())
    case 'heading': {
      const level = Math.min(6, Math.max(1, n.attrs?.level ?? 2))
      return h(`h${level}`, { class: `mt-4 mb-1 font-semibold first:mt-0 ${HEADING[level]}` }, kids())
    }
    case 'bulletList':
      return h('ul', { class: 'my-2 list-disc space-y-1 pl-5' }, kids())
    case 'orderedList':
      return h('ol', { class: 'my-2 list-decimal space-y-1 pl-5' }, kids())
    case 'listItem':
      // list items wrap a paragraph; drop its margins inside the list
      return h('li', (n.content ?? []).map((c) => (c.type === 'paragraph' ? h('span', (c.content ?? []).map(node)) : node(c))))
    case 'blockquote':
      return h('blockquote', { class: 'my-2 border-l-2 border-border pl-3 text-muted-foreground [&>p]:my-1' }, kids())
    case 'hardBreak':
      return h('br')
    case 'rule':
      return h('hr', { class: 'my-3 border-border' })
    case 'mention':
      return h('span', { class: 'rounded bg-primary/12 px-1 font-medium text-primary' }, String(n.attrs?.text ?? '@someone'))
    case 'emoji':
      return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
    case 'inlineCard':
    case 'blockCard': {
      const url = String(n.attrs?.url ?? '')
      return SAFE_URL.test(url)
        ? h('a', { href: url, target: '_blank', rel: 'noopener', class: 'text-primary underline underline-offset-2 break-all' }, url.replace(/^https?:\/\//, ''))
        : ''
    }
    case 'mediaSingle':
    case 'mediaGroup':
      return h('div', { class: 'my-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground' }, 'Image or attachment: open in Jira to view')
    case 'panel':
      return h('div', { class: 'my-2 rounded-md border bg-muted/50 px-3 py-1' }, kids())
    case 'table':
      return h('div', { class: 'my-2 overflow-x-auto' }, [h('table', { class: 'w-full border-collapse text-xs' }, [h('tbody', kids())])])
    case 'tableRow':
      return h('tr', kids())
    case 'tableHeader':
      return h('th', { class: 'border bg-muted px-2 py-1 text-left font-semibold [&>p]:my-0' }, kids())
    case 'tableCell':
      return h('td', { class: 'border px-2 py-1 align-top [&>p]:my-0' }, kids())
    case 'codeBlock':
      return h('pre', { class: 'my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs' }, (n.content ?? []).map((c) => c.text ?? '').join(''))
    default:
      return h('div', kids())
  }
}

const render = () => h('div', { class: 'text-sm leading-relaxed break-words' }, props.doc.content.map(node))
</script>

<template>
  <render />
</template>
