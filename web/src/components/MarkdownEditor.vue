<script setup lang="ts">
import { computed, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import {
  PhCode,
  PhEye,
  PhLinkSimple,
  PhListBullets,
  PhListNumbers,
  PhPencilSimple,
  PhQuotes,
  PhTextB,
  PhTextItalic,
} from '@phosphor-icons/vue'
import { insertLink, toggleLinePrefix, toggleWrap } from '@/composables/markdownFormat'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { markdownToAdf } from '@shared/adf'
import { useLayout } from '@/stores/layout'
import AdfView from './AdfView.vue'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

/** Markdown field with Write / Preview tabs. The preview shows the same Jira document the server sends. */
const props = withDefaults(
  defineProps<{
    label?: string
    placeholder?: string
    /** Starting height in px (both tabs) */
    height?: number
    /** Remembers Write / Preview separately per use, e.g. 'jira-description', 'pr-note' */
    stateKey?: string
    /** Fill the parent's height (a flex column) instead of a fixed height */
    fill?: boolean
    /** Previews for attachment:name images in the text */
    images?: Record<string, string>
  }>(),
  { height: 288, stateKey: 'default' },
)
const emit = defineEmits<{ blur: [] }>()
const model = defineModel<string>({ required: true })
const v = useLayout().view(`markdown-editor:${props.stateKey}`, { tab: 'write' as 'write' | 'preview' })
const doc = computed(() => markdownToAdf(model.value))

// ---- Formatting toolbar and shortcuts (GitHub's keys)
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
const el = () => textarea.value?.$el as HTMLTextAreaElement | undefined
const ACTIONS = [
  { label: 'Bold', icon: PhTextB, keys: `${mod}B`, match: (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === 'b', run: (t: HTMLTextAreaElement) => toggleWrap(t, '**', 'bold text') },
  { label: 'Italic', icon: PhTextItalic, keys: `${mod}I`, match: (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === 'i', run: (t: HTMLTextAreaElement) => toggleWrap(t, '_', 'italic text') },
  { label: 'Code', icon: PhCode, keys: `${mod}E`, match: (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === 'e', run: (t: HTMLTextAreaElement) => toggleWrap(t, '`', 'code') },
  { label: 'Link', icon: PhLinkSimple, keys: `${mod}K`, match: (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === 'k', run: insertLink },
  { label: 'Bullet list', icon: PhListBullets, keys: `${mod}⇧8`, match: (e: KeyboardEvent) => e.shiftKey && e.code === 'Digit8', run: (t: HTMLTextAreaElement) => toggleLinePrefix(t, 'bullet') },
  { label: 'Numbered list', icon: PhListNumbers, keys: `${mod}⇧7`, match: (e: KeyboardEvent) => e.shiftKey && e.code === 'Digit7', run: (t: HTMLTextAreaElement) => toggleLinePrefix(t, 'number') },
  { label: 'Quote', icon: PhQuotes, keys: `${mod}⇧.`, match: (e: KeyboardEvent) => e.shiftKey && e.code === 'Period', run: (t: HTMLTextAreaElement) => toggleLinePrefix(t, 'quote') },
]
function onKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return
  const a = ACTIONS.find((x) => x.match(e))
  if (!a) return
  e.preventDefault()
  a.run(e.target as HTMLTextAreaElement)
}
function apply(a: (typeof ACTIONS)[number]) {
  const t = el()
  if (t) a.run(t)
}

/** Pasting a URL over selected text makes it a link: [selection](url) */
const URL_ONLY = /^(https?:\/\/|mailto:)\S+$/i
function onPaste(e: ClipboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const url = e.clipboardData?.getData('text/plain').trim() ?? ''
  const selected = el.value.slice(el.selectionStart, el.selectionEnd)
  if (!selected.trim() || !URL_ONLY.test(url) || URL_ONLY.test(selected.trim()) || selected.includes('\n')) return
  e.preventDefault()
  const link = `[${selected}](${url})`
  // insertText keeps the browser's undo history (Cmd+Z undoes the whole paste) and fires input for v-model
  if (!document.execCommand('insertText', false, link)) {
    const start = el.selectionStart
    model.value = el.value.slice(0, start) + link + el.value.slice(el.selectionEnd)
    requestAnimationFrame(() => el.setSelectionRange(start + link.length, start + link.length))
  }
}

// Write and Preview share one height (including after you drag-resize the textarea), so switching doesn't jump
const height = ref(props.height)
const textarea = ref<{ $el: HTMLElement } | null>(null)
useResizeObserver(
  () => textarea.value?.$el,
  ([entry]) => {
    const h = (entry.target as HTMLElement).offsetHeight
    if (h) height.value = h
  },
)
</script>

<template>
  <Tabs v-model="v.tab" :class="['gap-1.5', fill && 'min-h-0 flex-1']">
    <!-- Label and tabs keep their size; the formatting buttons scroll sideways when space runs out -->
    <div class="flex items-center gap-2">
      <div class="shrink-0 whitespace-nowrap"><slot name="label"><Label>{{ label }}</Label></slot></div>
      <div
        v-if="v.tab === 'write'"
        class="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] *:shrink-0 [&::-webkit-scrollbar]:hidden [&>*:first-child]:ml-auto"
        role="toolbar"
        aria-label="Formatting"
      >
        <Tooltip v-for="a in ACTIONS" :key="a.label">
          <TooltipTrigger as-child>
            <!-- mousedown.prevent keeps the textarea's selection -->
            <Button type="button" variant="ghost" size="icon-xs" :aria-label="`${a.label} (${a.keys})`" @mousedown.prevent @click="apply(a)">
              <component :is="a.icon" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ a.label }} <span class="opacity-70">{{ a.keys }}</span></TooltipContent>
        </Tooltip>
      </div>
      <span v-else class="flex-1" />
      <TabsList class="h-8 shrink-0">
        <TabsTrigger value="write" class="px-2.5 text-xs"><PhPencilSimple /> Write</TabsTrigger>
        <TabsTrigger value="preview" class="px-2.5 text-xs"><PhEye /> Preview</TabsTrigger>
      </TabsList>
    </div>
    <TabsContent value="write" :class="fill && 'min-h-0'">
      <Textarea
        ref="textarea"
        v-model="model"
        :placeholder="placeholder"
        :class="['field-sizing-fixed font-mono text-xs', fill ? 'h-full resize-none' : 'resize-y']"
        :style="fill ? undefined : { height: `${height}px` }"
        @paste="onPaste"
        @keydown="onKeydown"
        @blur="emit('blur')"
      />
    </TabsContent>
    <TabsContent value="preview" :class="fill && 'min-h-0'">
      <div class="overflow-y-auto rounded-md border bg-background px-4 py-3" :class="fill && 'h-full'" :style="fill ? undefined : { height: `${height}px` }">
        <AdfView v-if="doc.content.length" :doc="doc" :images="images" />
        <p v-else class="text-sm text-muted-foreground">Nothing to preview.</p>
      </div>
    </TabsContent>
  </Tabs>
</template>
