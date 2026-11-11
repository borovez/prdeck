<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

/** GitHub's rendered PR description, sanitized again, styled like the rest of the app */
const props = defineProps<{ html: string }>()
const safe = computed(() => sanitizeHtml(props.html))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="html.trim()" class="gh-markdown text-sm leading-relaxed break-words" v-html="safe" />
  <p v-else class="text-sm text-muted-foreground">No description.</p>
</template>

<style>
.gh-markdown > :first-child { margin-top: 0; }
.gh-markdown :is(p, ul, ol, blockquote, pre, table, details) { margin: 0.6rem 0; }
.gh-markdown :is(h1, h2, h3, h4) { margin: 1.1rem 0 0.4rem; font-weight: 600; line-height: 1.3; }
.gh-markdown h1 { font-size: 1.25rem; }
.gh-markdown h2 { font-size: 1.1rem; padding-bottom: 0.2rem; border-bottom: 1px solid var(--border); }
.gh-markdown h3 { font-size: 1rem; }
.gh-markdown :is(ul, ol) { padding-left: 1.4rem; }
.gh-markdown ul { list-style: disc; }
.gh-markdown ol { list-style: decimal; }
.gh-markdown li + li { margin-top: 0.2rem; }
.gh-markdown li:has(> input[type='checkbox']) { list-style: none; margin-left: -1.2rem; }
.gh-markdown input[type='checkbox'] { margin-right: 0.35rem; vertical-align: -1px; accent-color: var(--primary); }
.gh-markdown a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.gh-markdown code { background: var(--muted); border-radius: 0.25rem; padding: 0.05rem 0.3rem; font-size: 0.85em; }
.gh-markdown pre { background: var(--muted); border-radius: 0.375rem; padding: 0.75rem; overflow-x: auto; font-size: 0.75rem; }
.gh-markdown pre code { background: none; padding: 0; }
.gh-markdown blockquote { border-left: 2px solid var(--border); padding-left: 0.75rem; color: var(--muted-foreground); }
.gh-markdown table { display: block; overflow-x: auto; border-collapse: collapse; font-size: 0.75rem; }
.gh-markdown :is(th, td) { border: 1px solid var(--border); padding: 0.25rem 0.5rem; }
.gh-markdown th { background: var(--muted); font-weight: 600; }
.gh-markdown img { max-width: 100%; border-radius: 0.375rem; }
.gh-markdown hr { margin: 1rem 0; border-color: var(--border); }
.gh-markdown summary { cursor: pointer; font-weight: 500; }
</style>
