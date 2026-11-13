<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowCounterClockwise, PhArrowSquareOut, PhCircleNotch, PhGitPullRequest, PhSparkle, PhX } from '@phosphor-icons/vue'
import type { PrRewrite } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { lineDiff } from '@/utils/lineDiff'
import { fileSize, useImageAttachments } from '@/composables/imageAttachments'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import AiPromptBox from './AiPromptBox.vue'
import MarkdownEditor from './MarkdownEditor.vue'

/**
 * Edit a PR's title and description, with Claude: it follows the repo's PR template and CLAUDE.md and
 * reads the diff, commits and linked Jira issues. Its answer is reviewed as a diff before it touches the
 * editor; Save writes to GitHub. Dependency and flag lines are never lost (the server puts them back).
 */
const deck = useDeck()
const prId = computed(() => deck.prWriter)
const pr = computed(() => (prId.value ? deck.byId.get(prId.value) : undefined))
const open = computed({ get: () => !!prId.value, set: (v) => !v && (deck.prWriter = null) })

const loading = ref(false)
const saving = ref(false)
const title = ref('')
const body = ref('')
const original = ref<{ title: string; body: string } | null>(null)

const aiReady = computed(() => !!deck.overview?.configured.ai)
const prompt = ref('')
const drafting = ref(false)
const proposal = ref<PrRewrite | null>(null)
const picked = ref<Set<'title' | 'body'>>(new Set())
const applied = ref<PrRewrite | null>(null)
const undo = ref<{ title: string; body: string } | null>(null)
/** Images for Claude only (a screenshot of the change, a design) */
const images = useImageAttachments((m) => toast.error(m))
let abort: AbortController | null = null
// Only the Claude box takes dropped images here
images.whenDropped((files, e) => void ((e.target as HTMLElement | null)?.closest?.('[data-ai-images]') && images.add(files)))

const QUICK = ['Follow the PR template', 'Add deployment steps', 'Make it shorter', 'Update it from the latest commits']

watch(
  prId,
  async (id) => {
    proposal.value = null
    applied.value = null
    undo.value = null
    prompt.value = ''
    images.clear()
    original.value = null
    if (!id) return
    loading.value = true
    try {
      const t = await api.prText(id)
      title.value = t.title
      body.value = t.body
      original.value = t
    } catch (e) {
      toast.error((e as Error).message)
      deck.prWriter = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function rewrite() {
  if (!prId.value || drafting.value || !prompt.value.trim()) return
  drafting.value = true
  abort = new AbortController()
  try {
    const r = await api.prRewrite({ prId: prId.value, prompt: prompt.value, current: { title: title.value, body: body.value }, images: await images.forDraft() }, abort.signal)
    proposal.value = r
    picked.value = new Set([...(r.title !== title.value ? ['title' as const] : []), ...(r.body.trim() !== body.value.trim() ? ['body' as const] : [])])
    prompt.value = ''
  } catch (e) {
    if ((e as Error).name === 'AbortError') toast('Stopped Claude', { description: 'Nothing was changed.' })
    else toast.error((e as Error).message)
  } finally {
    drafting.value = false
    abort = null
  }
}
const bodyDiff = computed(() => (proposal.value && proposal.value.body.trim() !== body.value.trim() ? lineDiff(body.value, proposal.value.body) : null))
const titleChanged = computed(() => !!proposal.value && proposal.value.title !== title.value)
function toggle(k: 'title' | 'body') {
  const next = new Set(picked.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  picked.value = next
}
function apply() {
  const p = proposal.value
  if (!p) return
  undo.value = { title: title.value, body: body.value }
  if (picked.value.has('title')) title.value = p.title
  if (picked.value.has('body')) body.value = p.body
  applied.value = p
  proposal.value = null
}
function undoApply() {
  if (!undo.value) return
  title.value = undo.value.title
  body.value = undo.value.body
  undo.value = null
  applied.value = null
}

const changed = computed(() => {
  const o = original.value
  return o ? { title: title.value.trim() !== o.title, body: body.value !== o.body } : { title: false, body: false }
})
async function save() {
  const id = prId.value
  if (!id || saving.value || (!changed.value.title && !changed.value.body) || !title.value.trim()) return
  saving.value = true
  try {
    await api.savePrText({ prId: id, ...(changed.value.title ? { title: title.value.trim() } : {}), ...(changed.value.body ? { body: body.value } : {}) })
    toast.success(`Updated ${id} on GitHub`)
    deck.prWriter = null
    // Re-read the PR so the panel shows the new description
    await deck.mutate(() => api.resyncPr(id))
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      class="flex h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl"
      @keydown.meta.enter.prevent="save"
      @keydown.ctrl.enter.prevent="save"
      @paste="(e: ClipboardEvent) => (e.target as HTMLElement).closest('[data-ai-images]') && images.onPaste(e)"
      v-on="images.dragHandlers"
    >
      <div class="flex items-center gap-2 px-4 pt-3">
        <PhGitPullRequest class="size-4 text-muted-foreground" />
        <DialogTitle class="truncate font-mono text-sm font-medium">{{ prId }}</DialogTitle>
        <DialogDescription class="sr-only">Edit the pull request's title and description, with Claude</DialogDescription>
        <span class="flex-1" />
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" title="Close (Esc)" @click="deck.prWriter = null"><PhX /></Button>
      </div>

      <div class="px-4 pt-3">
        <AiPromptBox
          v-model="prompt"
          :drafting="drafting"
          :ready="aiReady"
          placeholder="Ask Claude: “follow the PR template”, “add deployment steps”, “mention the migration”… (paste screenshots too)"
          action="Rewrite with Claude"
          @submit="rewrite"
          @stop="abort?.abort()"
        >
          <template #context>
            <span class="text-xs font-medium text-primary/80">Try</span>
            <button
              v-for="q in QUICK"
              :key="q"
              type="button"
              class="h-6 rounded-full border border-primary/25 bg-background/60 px-2.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              @click="prompt = q"
            >
              {{ q }}
            </button>
            <span
              v-for="img in images.images.value"
              :key="img.id"
              class="inline-flex h-6 max-w-48 items-center gap-1.5 rounded-md border bg-background pr-1 pl-1 text-xs"
              :title="`${img.name} · ${fileSize(img.size)}: for Claude only`"
            >
              <img :src="img.url" alt="" class="size-4 rounded-sm object-cover" />
              <span class="min-w-0 truncate">{{ img.name }}</span>
              <button type="button" class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent" :aria-label="`Remove ${img.name}`" @click="images.remove(img.id)">
                <PhX class="size-3" />
              </button>
            </span>
          </template>

          <!-- Claude's answer, reviewed before it touches the editor -->
          <div v-if="proposal" class="border-t border-primary/20 px-3 py-2.5">
            <p class="flex items-start gap-2 text-xs text-muted-foreground">
              <PhSparkle class="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span class="font-medium text-foreground">{{ titleChanged || bodyDiff ? 'Review the changes.' : 'Claude suggests no changes.' }}</span>
                {{ proposal.rationale }}
                <span class="opacity-70">
                  (Read: {{ [proposal.used.template, proposal.used.claudeMd && 'CLAUDE.md', `${proposal.used.files} files`, `${proposal.used.commits} commits`, ...proposal.used.jira].filter(Boolean).join(', ') }})
                </span>
              </span>
            </p>
            <p v-if="proposal.kept.length" class="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning">
              Claude dropped {{ proposal.kept.length }} dependency or flag line(s); they were put back at the end.
            </p>
            <ScrollArea v-if="titleChanged || bodyDiff" class="mt-2 [&>[data-slot=scroll-area-viewport]]:max-h-[38vh]">
              <ul class="space-y-1.5 pr-2">
                <li v-if="titleChanged" class="rounded-md border bg-background/70 p-2">
                  <label class="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox :model-value="picked.has('title')" class="mt-0.5" @update:model-value="toggle('title')" />
                    <span class="w-24 shrink-0 font-medium">Title</span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-muted-foreground line-through decoration-destructive/60">{{ title }}</span>
                      <span class="text-success">{{ proposal.title }}</span>
                    </span>
                  </label>
                </li>
                <li v-if="bodyDiff" class="rounded-md border bg-background/70 p-2">
                  <label class="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox :model-value="picked.has('body')" class="mt-0.5" @update:model-value="toggle('body')" />
                    <span class="w-24 shrink-0 font-medium">Description</span>
                    <span class="text-xs text-muted-foreground">
                      +{{ bodyDiff.filter((l) => l.kind === 'add').length }} −{{ bodyDiff.filter((l) => l.kind === 'del').length }} lines
                    </span>
                  </label>
                  <pre class="mt-1.5 overflow-x-auto rounded bg-muted/60 py-1 font-mono text-[11px] leading-relaxed"><template v-for="(l, i) in bodyDiff" :key="i"><span
                    v-if="l.kind === 'gap'" class="block px-2 text-muted-foreground/60">⋯</span><span
                    v-else :class="['block px-2 whitespace-pre-wrap', l.kind === 'add' && 'bg-success/15 text-success', l.kind === 'del' && 'bg-destructive/12 text-destructive line-through decoration-destructive/40', l.kind === 'same' && 'text-muted-foreground']">{{ l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  ' }}{{ l.text }}</span></template></pre>
                </li>
              </ul>
            </ScrollArea>
            <div class="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" class="h-7" @click="proposal = null">Discard</Button>
              <Button v-if="titleChanged || bodyDiff" size="sm" class="h-7" :disabled="!picked.size" @click="apply">Apply</Button>
            </div>
          </div>
          <div v-else-if="applied" class="flex items-start gap-2 border-t border-primary/20 px-3 py-2 text-xs text-muted-foreground">
            <PhSparkle class="mt-0.5 size-3.5 shrink-0 text-primary" />
            <p class="min-w-0 flex-1">{{ applied.rationale }}</p>
            <button v-if="undo" type="button" class="flex shrink-0 items-center gap-1 hover:text-foreground" @click="undoApply"><PhArrowCounterClockwise /> Undo</button>
          </div>
        </AiPromptBox>
      </div>
      <div class="mx-4 mt-3 h-px bg-border" />

      <div class="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3">
        <template v-if="loading">
          <Skeleton class="h-8 w-2/3" />
          <Skeleton class="min-h-0 flex-1" />
        </template>
        <template v-else>
          <input v-model="title" placeholder="Title" class="bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60" />
          <MarkdownEditor v-model="body" placeholder="Description (Markdown)" state-key="pr-writer" fill />
        </template>
      </div>

      <div class="mt-3 flex items-center gap-3 border-t px-4 py-3">
        <a v-if="pr" :href="pr.url" target="_blank" rel="noopener" class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <PhArrowSquareOut /> Open on GitHub
        </a>
        <span class="flex-1" />
        <span v-if="changed.title || changed.body" class="text-xs text-muted-foreground">
          {{ [changed.title && 'title', changed.body && 'description'].filter(Boolean).join(' and ') }} changed
        </span>
        <Button size="sm" :disabled="saving || loading || (!changed.title && !changed.body) || !title.trim()" title="⌘↵" @click="save">
          <PhCircleNotch v-if="saving" class="animate-spin" /> Save to GitHub
        </Button>
      </div>

      <div
        v-if="images.dragging.value"
        class="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary"
      >
        Drop images on the Claude box to show them to Claude
      </div>
    </DialogContent>
  </Dialog>
</template>
