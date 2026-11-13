<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowCounterClockwise, PhArrowSquareOut, PhArrowsIn, PhArrowsOut, PhCaretRight, PhCheck, PhGitBranch, PhGitPullRequest, PhSlackLogo, PhSparkle, PhCircleNotch, PhDotsThree, PhKanban, PhX } from '@phosphor-icons/vue'
import type { JiraAiDraft, JiraFieldMeta, JiraFieldOption, JiraFieldValue, JiraIssueTypeMeta, JiraProjectMeta, JiraValueLabels } from '@shared/types'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import JiraFieldChip from './JiraFieldChip.vue'
import AiPromptBox from './AiPromptBox.vue'
import { Checkbox } from '@/components/ui/checkbox'
import { lineDiff } from '@/utils/lineDiff'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { fileSize, uniqueForDraft, useImageAttachments, type PendingImage } from '@/composables/imageAttachments'
import MarkdownEditor from './MarkdownEditor.vue'

/**
 * Linear-style Jira issue composer, for a new issue or an existing one (deck.composer).
 * Fields come from Jira's create / edit metadata, so each project's own fields (required ones,
 * story points, sprint, Urgency…) show up as chips without code; ⋯ adds any other field.
 */
const deck = useDeck()
const target = computed(() => deck.composer)
const open = computed({ get: () => !!target.value, set: (v) => !v && close() })
const editKey = computed(() => (target.value?.mode === 'edit' ? target.value.key : null))

const prefs = useLayout().view('jira-composer', {
  project: '',
  expanded: false,
  createMore: false,
  /** Fields added with ⋯, per project */
  extra: {} as Record<string, string[]>,
  /** Last values of required fields, per project, so the next issue starts with them */
  last: {} as Record<string, Record<string, JiraFieldValue>>,
})

const loading = ref(false)
const busy = ref(false)
const projects = ref<JiraProjectMeta[]>([])
const project = ref<JiraProjectMeta | null>(null)
const issueTypes = ref<JiraIssueTypeMeta[]>([])
const issueTypeId = ref('')
const fields = ref<JiraFieldMeta[]>([])
const summary = ref('')
const description = ref('')
const values = ref<Record<string, JiraFieldValue>>({})
const known = ref<JiraValueLabels>({})
const url = ref('')
/** Edit mode: what the issue had when opened, to send only changes */
const initial = ref<{ summary: string; description: string; issueTypeId: string; values: Record<string, JiraFieldValue> } | null>(null)
const titleInput = ref<HTMLTextAreaElement | null>(null)
const moreOpen = ref(false)
/** Edit mode: Claude's answer waits here for review; ticked changes are applied to the form */
const proposal = ref<JiraAiDraft | null>(null)
/** Chips Claude filled, marked until you change them */
const suggested = ref<Set<string>>(new Set())
const picked = ref<Set<string>>(new Set())
/** Posted as a Jira comment with the save, when switched on */
const commentText = ref('')
const postComment = ref(false)
/** Pasted / dropped images: Claude sees them, and they're attached to the issue */
const attach = useImageAttachments((m) => toast.error(m))
/** Images pasted or dropped on the Claude box: context for Claude only, not attached to the issue */
const aiImages = useImageAttachments(
  (m) => toast.error(m),
  // Already attached to the issue: Claude sees it from there
  (hash) => attach.images.value.find((i) => i.hash === hash)?.name ?? null,
)
const inClaudeBox = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('[data-ai-images]')
/** attachment:name → local preview, for the description's Preview tab */
const imagePreviews = computed(() => Object.fromEntries(attach.images.value.map((i) => [encodeURIComponent(i.name), i.url])))
const imageRef = (name: string) => `![${name}](attachment:${encodeURIComponent(name)})`
/** Images pasted or dropped into the description go in at the cursor, as attachment:name images */
function insertImages(el: HTMLTextAreaElement, added: PendingImage[]) {
  if (!added.length) return
  const before = el.value.slice(0, el.selectionStart)
  const text = `${before && !before.endsWith('\n') ? '\n' : ''}${added.map((i) => imageRef(i.name)).join('\n')}\n`
  el.focus()
  // insertText keeps undo history and updates v-model
  if (!document.execCommand('insertText', false, text)) description.value = before + text + el.value.slice(el.selectionEnd)
}
const descriptionTextarea = (target: EventTarget | null) => {
  const box = (target as HTMLElement | null)?.closest?.('[data-inline-images]')
  return (box?.querySelector('textarea') as HTMLTextAreaElement | null) ?? null
}
async function onPaste(e: ClipboardEvent) {
  if (inClaudeBox(e.target)) return void aiImages.onPaste(e)
  const el = descriptionTextarea(e.target)
  const inDescription = !!el && e.target === el
  // In the description, the same image again is another reference to the one upload
  const added = await attach.onPaste(e, { reuse: inDescription })
  if (inDescription) insertImages(el, added)
}
attach.whenDropped(async (files, e) => {
  if (inClaudeBox(e.target)) return void aiImages.add(files)
  const el = descriptionTextarea(e.target)
  const added = await attach.add(files, { reuse: !!el })
  if (el) insertImages(el, added)
})
function removeImage(img: PendingImage) {
  attach.remove(img.id)
  const ref = imageRef(img.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  description.value = description.value.replace(new RegExp(`\\n?${ref}`, 'g'), '')
}
const aiPrompt = ref('')
const drafting = ref(false)
const drafted = ref<JiraAiDraft | null>(null)
/** What was there before Claude's draft, for Undo */
const undo = ref<{ summary: string; description: string; issueTypeId: string; values: Record<string, JiraFieldValue> } | null>(null)
/** Context Claude reads: a PR, a Slack message, a repo whose CLAUDE.md guides the writing */
const ctx = ref<{ prId: string | null; slackItemId: string | null; repo: string | null }>({ prId: null, slackItemId: null, repo: null })

function close() {
  deck.composer = null
}

/** A plain copy of reactive state (structuredClone can't copy Vue's proxies) */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const isEmpty = (v: JiraFieldValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)

async function loadCreate(projectKey: string, typeId?: string, keepValues = false) {
  loading.value = true
  try {
    const meta = await api.jiraMeta(projectKey, typeId)
    project.value = meta.project
    issueTypes.value = meta.issueTypes.filter((t) => !t.subtask)
    issueTypeId.value = meta.issueTypeId
    fields.value = meta.fields
    known.value = { ...known.value, ...meta.labels }
    const seed = target.value?.mode === 'create' ? (target.value.values ?? {}) : {}
    const last = prefs.last[projectKey] ?? {}
    const lastRequired = Object.fromEntries(meta.fields.filter((f) => f.required && last[f.key] !== undefined).map((f) => [f.key, last[f.key]]))
    // Keep what was picked for fields the new type also has
    const kept = keepValues ? Object.fromEntries(Object.entries(values.value).filter(([k]) => meta.fields.some((f) => f.key === k))) : {}
    values.value = { ...meta.defaults, ...lastRequired, ...kept, ...seed }
    prefs.project = projectKey
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function loadEdit(key: string) {
  loading.value = true
  try {
    const e = await api.jiraEditable(key)
    project.value = e.project
    issueTypes.value = e.issueTypes.filter((t) => !t.subtask || t.id === e.issueTypeId)
    issueTypeId.value = e.issueTypeId
    fields.value = e.fields
    summary.value = e.summary
    description.value = e.description
    values.value = structuredClone(e.values)
    known.value = e.labels
    url.value = e.url
    initial.value = { summary: e.summary, description: e.description, issueTypeId: e.issueTypeId, values: structuredClone(e.values) }
  } catch (err) {
    toast.error((err as Error).message)
    close()
  } finally {
    loading.value = false
  }
}

watch(
  target,
  async (t) => {
    if (!t) return
    moreOpen.value = false
    proposal.value = null
    suggested.value = new Set()
    commentText.value = ''
    postComment.value = false
    attach.clear()
    aiImages.clear()
    project.value = null
    fields.value = []
    values.value = {}
    known.value = {}
    initial.value = null
    url.value = ''
    if (t.mode === 'edit') return loadEdit(t.key)
    summary.value = t.summary ?? ''
    description.value = t.description ?? ''
    ctx.value = { prId: t.prId ?? null, slackItemId: t.slackItemId ?? null, repo: t.prId ? (deck.byId.get(t.prId)?.repo ?? null) : null }
    aiPrompt.value = ''
    drafted.value = null
    undo.value = null
    if (!projects.value.length) api.jiraProjects().then((p) => (projects.value = p), () => {})
    const fallback = t.projectKey || prefs.project || (await api.settings().catch(() => null))?.jira?.create.projectKey || ''
    if (fallback) await loadCreate(fallback)
    titleInput.value?.focus()
  },
  { immediate: true },
)

// ---------- Chips ----------

const isStoryPoints = (f: JiraFieldMeta) => /story.?points?/i.test(f.name) || !!f.custom?.includes('story-points')
/** Shown by default, in this order */
const rank = (f: JiraFieldMeta) => {
  const order = ['priority', 'assignee', 'labels', 'parent']
  if (order.includes(f.key)) return order.indexOf(f.key)
  if (f.kind === 'sprint') return 4
  if (isStoryPoints(f)) return 5
  if (f.key === 'components') return 6
  if (f.key === 'fixVersions') return 7
  return -1
}
const extraKeys = computed(() => (project.value ? (prefs.extra[project.value.key] ?? []) : []))
const visible = computed(() => {
  const shown = fields.value.filter((f) => rank(f) >= 0 || f.required || extraKeys.value.includes(f.key) || (editKey.value && !isEmpty(values.value[f.key])))
  return shown.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra >= 0 || rb >= 0) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
    return Number(b.required) - Number(a.required) || a.name.localeCompare(b.name)
  })
})
/** ⋯ menu: every field that isn't always shown; ticked ones are added */
const more = computed(() => fields.value.filter((f) => rank(f) < 0 && !f.required).sort((a, b) => a.name.localeCompare(b.name)))
const moreQuery = ref('')
function toggleField(f: JiraFieldMeta) {
  if (!project.value) return
  const on = extraKeys.value.includes(f.key)
  prefs.extra = { ...prefs.extra, [project.value.key]: on ? extraKeys.value.filter((k) => k !== f.key) : [...extraKeys.value, f.key] }
}
function learn(key: string, options: JiraFieldOption[]) {
  known.value = { ...known.value, [key]: { ...known.value[key], ...Object.fromEntries(options.map((o) => [o.id, o])) } }
}

/** Issue type and project as chips (same picker) */
const typeField = computed<JiraFieldMeta>(() => ({
  key: 'issuetype',
  name: 'Type',
  kind: 'option',
  required: true,
  options: issueTypes.value.map((t) => ({ id: t.id, label: t.name, iconUrl: t.iconUrl })),
}))
const projectField = computed<JiraFieldMeta>(() => ({
  key: 'project',
  name: 'Project',
  kind: 'option',
  required: true,
  options: projects.value.map((p) => ({ id: p.key, label: p.key, detail: p.name, iconUrl: p.avatarUrl })),
}))
const typeModel = computed({
  get: () => issueTypeId.value,
  set: (id) => {
    if (!id || id === issueTypeId.value) return
    issueTypeId.value = String(id)
    // A new type can have other fields (create); edit keeps the issue's fields
    if (!editKey.value && project.value) loadCreate(project.value.key, String(id), true)
  },
})
const projectModel = computed({
  get: () => project.value?.key ?? '',
  set: (k) => k && k !== project.value?.key && loadCreate(String(k)),
})

// ---------- Claude ----------

const aiReady = computed(() => !!deck.overview?.configured.ai)
const slackItem = computed(() => (ctx.value.slackItemId ? (deck.overview?.slack ?? []).find((i) => i.id === ctx.value.slackItemId) : null))
const replyInThread = ref(true)

const prField = computed<JiraFieldMeta>(() => ({
  key: 'ctx-pr',
  name: 'Pull request',
  kind: 'option',
  required: false,
  options: deck.prs.map((p) => ({ id: p.id, label: `${p.repo.split('/')[1]}#${p.number} ${p.title}`, detail: p.repo })),
}))
const repoField = computed<JiraFieldMeta>(() => ({
  key: 'ctx-repo',
  name: 'Repo CLAUDE.md',
  kind: 'option',
  required: false,
  options: deck.repos.map((r) => ({ id: r, label: r.split('/')[1], detail: r })),
}))
const prModel = computed({
  get: () => ctx.value.prId,
  set: (id) => {
    ctx.value.prId = id ? String(id) : null
    // The PR's repo guides the writing unless one was picked
    if (id && !ctx.value.repo) ctx.value.repo = deck.byId.get(String(id))?.repo ?? null
  },
})
const repoModel = computed({ get: () => ctx.value.repo, set: (r) => (ctx.value.repo = r ? String(r) : null) })

/** The running draft request, so Stop can cancel it (the server stops Claude too) */
let abort: AbortController | null = null
const canDraft = computed(() => aiReady.value && !!project.value && !!aiPrompt.value.trim())
function stopDrafting() {
  abort?.abort()
}
async function draftWithClaude() {
  if (!canDraft.value || drafting.value || !project.value) return
  drafting.value = true
  abort = new AbortController()
  try {
    const d = await api.jiraDraft({
      projectKey: project.value.key,
      issueTypeId: issueTypeId.value,
      fieldKeys: visible.value.map((f) => f.key),
      prompt: aiPrompt.value,
      current: { summary: summary.value, description: description.value, values: values.value },
      context: ctx.value,
      images: await uniqueForDraft(aiImages, attach),
      issueKey: editKey.value,
    }, abort.signal)
    if (editKey.value) {
      // Edits are reviewed first: every change starts ticked
      for (const [k, l] of Object.entries(d.labels)) learn(k, Object.values(l))
      proposal.value = d
      picked.value = new Set(proposalChanges.value.map((c) => c.id))
      aiPrompt.value = ''
      return
    }
    undo.value = { summary: summary.value, description: description.value, issueTypeId: issueTypeId.value, values: plain(values.value) }
    if (d.issueTypeId !== issueTypeId.value && !editKey.value) {
      issueTypeId.value = d.issueTypeId
      await loadCreate(project.value.key, d.issueTypeId, true)
    }
    summary.value = d.summary
    description.value = d.description
    values.value = { ...values.value, ...d.values }
    suggested.value = new Set([...Object.keys(d.values), ...(undo.value.issueTypeId !== d.issueTypeId ? ['issuetype'] : [])])
    for (const [k, l] of Object.entries(d.labels)) learn(k, Object.values(l))
    drafted.value = d
    aiPrompt.value = ''
  } catch (e) {
    if ((e as Error).name === 'AbortError') toast('Stopped Claude', { description: 'Nothing was changed.' })
    else toast.error((e as Error).message)
  } finally {
    drafting.value = false
    abort = null
  }
}
async function undoDraft() {
  const u = undo.value
  if (!u || !project.value) return
  if (u.issueTypeId !== issueTypeId.value && !editKey.value) {
    issueTypeId.value = u.issueTypeId
    await loadCreate(project.value.key, u.issueTypeId, true)
  }
  summary.value = u.summary
  description.value = u.description
  values.value = u.values
  undo.value = null
  drafted.value = null
  suggested.value = new Set()
}
/** How a value reads in the review: option labels, names, or "None" */
function valueLabel(f: JiraFieldMeta | undefined, v: JiraFieldValue | undefined): string {
  if (isEmpty(v)) return 'None'
  const list = Array.isArray(v) ? v : [String(v)]
  return list.map((x) => f?.options.find((o) => o.id === x)?.label ?? (f && known.value[f.key]?.[x]?.label) ?? x).join(', ')
}
/** Claude's proposal as reviewable changes against what the form has now */
const proposalChanges = computed(() => {
  const d = proposal.value
  if (!d) return []
  const out: { id: string; label: string; before: string; after: string; diff?: ReturnType<typeof lineDiff> }[] = []
  if (d.summary.trim() && d.summary !== summary.value) out.push({ id: 'summary', label: 'Title', before: summary.value, after: d.summary })
  if (d.issueTypeId !== issueTypeId.value) {
    const name = (id: string) => issueTypes.value.find((t) => t.id === id)?.name ?? id
    out.push({ id: 'issuetype', label: 'Type', before: name(issueTypeId.value), after: name(d.issueTypeId) })
  }
  if (d.description.trim() && d.description.trim() !== description.value.trim())
    out.push({ id: 'description', label: 'Description', before: '', after: '', diff: lineDiff(description.value, d.description) })
  for (const [k, v] of Object.entries(d.values)) {
    if (same(v, values.value[k])) continue
    const f = fields.value.find((x) => x.key === k)
    out.push({ id: `field:${k}`, label: f?.name ?? k, before: valueLabel(f, values.value[k]), after: valueLabel(f, v) })
  }
  return out
})
function untouch(key: string) {
  if (!suggested.value.has(key)) return
  const next = new Set(suggested.value)
  next.delete(key)
  suggested.value = next
}
function togglePick(id: string) {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}
function applyProposal() {
  const d = proposal.value
  if (!d) return
  undo.value = { summary: summary.value, description: description.value, issueTypeId: issueTypeId.value, values: plain(values.value) }
  for (const c of proposalChanges.value) {
    if (!picked.value.has(c.id)) continue
    if (c.id === 'summary') summary.value = d.summary
    else if (c.id === 'description') description.value = d.description
    else if (c.id === 'issuetype') issueTypeId.value = d.issueTypeId
    else values.value = { ...values.value, [c.id.slice('field:'.length)]: d.values[c.id.slice('field:'.length)] }
  }
  suggested.value = new Set([...proposalChanges.value.filter((c) => picked.value.has(c.id)).map((c) => (c.id.startsWith('field:') ? c.id.slice(6) : c.id))])
  commentText.value = d.changeSummary
  drafted.value = d
  proposal.value = null
}


// ---------- Submit ----------

const missing = computed(() => fields.value.filter((f) => f.required && isEmpty(values.value[f.key])))
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const changes = computed(() => {
  const i = initial.value
  if (!i) return null
  const changed = Object.fromEntries(Object.entries(values.value).filter(([k, v]) => !same(v, i.values[k])))
  return {
    ...(summary.value !== i.summary ? { summary: summary.value } : {}),
    ...(description.value !== i.description ? { description: description.value } : {}),
    ...(issueTypeId.value !== i.issueTypeId ? { issueTypeId: issueTypeId.value } : {}),
    ...(Object.keys(changed).length ? { values: changed } : {}),
  }
})
const changeCount = computed(
  () =>
    (changes.value ? Object.keys(changes.value).length - (changes.value.values ? 1 : 0) + Object.keys(changes.value.values ?? {}).length : 0) +
    attach.images.value.length,
)
const canSubmit = computed(
  () => !loading.value && !busy.value && !!summary.value.trim() && !!project.value && !missing.value.length && (!editKey.value || changeCount.value > 0),
)
const blockedReason = computed(() =>
  !summary.value.trim() ? 'Add a title' : missing.value.length ? `Set ${missing.value.map((f) => f.name).join(', ')}` : editKey.value && !changeCount.value ? 'Nothing changed' : undefined,
)

async function submit() {
  if (!canSubmit.value || !project.value) return
  busy.value = true
  try {
    if (editKey.value) {
      const issue = await api.jiraUpdateIssue(editKey.value, {
        ...changes.value!,
        attachments: attach.forUpload(),
        comment: postComment.value && commentText.value.trim() ? `Updated with Claude:\n\n${commentText.value}` : undefined,
      })
      toast.success(`Updated ${issue.key}`)
      await deck.load()
      close()
      return
    }
    const issue = await api.jiraCreateIssue({
      projectKey: project.value.key,
      issueTypeId: issueTypeId.value,
      summary: summary.value.trim(),
      description: description.value,
      values: Object.fromEntries(Object.entries(values.value).filter(([, v]) => !isEmpty(v))),
      slackItemId: ctx.value.slackItemId,
      replyInThread: !!ctx.value.slackItemId && replyInThread.value,
      attachments: attach.forUpload(),
    })
    if (issue.attachError) toast.warning(`${issue.key} was created, but the images weren't attached`, { description: issue.attachError })
    prefs.last = {
      ...prefs.last,
      [project.value.key]: Object.fromEntries(fields.value.filter((f) => f.required).map((f) => [f.key, values.value[f.key] ?? null])),
    }
    toast.success(`Created ${issue.key}${issue.replied ? ' and replied in Slack' : ''}`, { description: issue.summary, action: { label: 'Open', onClick: () => (deck.selectedJiraKey = issue.key) } })
    await deck.load()
    attach.clear()
    if (prefs.createMore) {
      summary.value = ''
      description.value = ''
      drafted.value = null
      undo.value = null
      titleInput.value?.focus()
    } else {
      close()
      deck.selectedJiraKey = issue.key
    }
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      :class="cn('flex flex-col gap-0 p-0 sm:max-w-3xl', prefs.expanded && 'h-[90vh] sm:max-w-5xl')"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
      @paste="onPaste"
      v-on="attach.dragHandlers"
    >
      <!-- Drop images anywhere on the dialog -->
      <div
        v-if="attach.dragging.value"
        class="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary backdrop-blur-[1px]"
      >
        Drop on the Claude box for context only, or anywhere else to attach to the issue
      </div>
      <!-- Header: project › New issue / key -->
      <div class="flex items-center gap-2 px-4 pt-3">
        <JiraFieldChip v-if="!editKey && project" v-model="projectModel" :field="projectField" :project="project.key" :icon="PhKanban" />
        <span v-else-if="project" class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs">
          <img v-if="project.avatarUrl" :src="project.avatarUrl" alt="" class="size-3.5 rounded-sm" />{{ project.key }}
        </span>
        <Skeleton v-else class="h-7 w-16" />
        <PhCaretRight class="size-3 text-muted-foreground" />
        <DialogTitle class="text-sm font-medium">
          <a v-if="editKey" :href="url" target="_blank" rel="noopener" class="font-mono hover:underline">{{ editKey }}</a>
          <template v-else>New issue</template>
        </DialogTitle>
        <DialogDescription class="sr-only">{{ editKey ? 'Edit the Jira issue' : 'Create a Jira issue' }}</DialogDescription>
        <span class="flex-1" />
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" :title="prefs.expanded ? 'Shrink' : 'Expand'" @click="prefs.expanded = !prefs.expanded">
          <PhArrowsIn v-if="prefs.expanded" /><PhArrowsOut v-else />
        </Button>
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground" title="Close (Esc)" @click="close"><PhX /></Button>
      </div>

      <!-- Ask Claude: writes or reworks the issue from your request and the context chips -->
      <AiPromptBox
        v-model="aiPrompt"
        class="mx-4 mt-3"
        :drafting="drafting"
        :ready="aiReady && !!project"
        :placeholder="editKey ? 'What should change? “add acceptance criteria from the comments”, “it’s a bug, priority high”…' : summary || description ? 'Ask Claude to change it: “make it a bug”, “add acceptance criteria”… (paste screenshots here too)' : 'Ask Claude to write it: describe the issue, paste notes, an error or a screenshot…'"
        :action="editKey ? 'Suggest changes' : drafted || summary || description ? 'Rewrite with Claude' : 'Draft with Claude'"
        @submit="draftWithClaude"
        @stop="stopDrafting"
      >
        <template #context>
          <span class="text-xs font-medium text-primary/80">Context</span>
          <JiraFieldChip v-if="project" v-model="prModel" :field="prField" :project="project.key" :icon="PhGitPullRequest" />
          <JiraFieldChip v-if="project" v-model="repoModel" :field="repoField" :project="project.key" :icon="PhGitBranch" />
          <span
            v-for="img in aiImages.images.value"
            :key="img.id"
            class="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border bg-background pr-1 pl-1 text-xs"
            :title="`${img.name} · ${fileSize(img.size)}: for Claude only`"
          >
            <img :src="img.url" alt="" class="size-5 rounded-sm object-cover" />
            <span class="min-w-0 truncate">{{ img.name }}</span>
            <button type="button" class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" :aria-label="`Remove ${img.name}`" @click="aiImages.remove(img.id)">
              <PhX class="size-3" />
            </button>
          </span>
          <span v-if="ctx.slackItemId" class="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border bg-background px-2 text-xs">
            <PhSlackLogo class="size-3.5" />
            <span class="truncate">{{ slackItem ? `${slackItem.userName} in ${slackItem.channelName}` : 'Slack message' }}</span>
          </span>
        </template>

        <!-- Edit mode: review Claude's changes before they touch the form -->
        <div v-if="proposal" class="border-t border-primary/20 px-3 py-2.5">
          <p class="flex items-start gap-2 text-xs text-muted-foreground">
            <PhSparkle class="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              <span class="font-medium text-foreground">{{ proposalChanges.length ? `Claude suggests ${proposalChanges.length} change${proposalChanges.length === 1 ? '' : 's'}` : 'Claude suggests no changes' }}.</span>
              {{ proposal.rationale }}
              <span v-if="proposal.used.comments || proposal.used.linkedPrs" class="opacity-70">
                (Read {{ [proposal.used.comments && `${proposal.used.comments} comments`, proposal.used.linkedPrs && `${proposal.used.linkedPrs} linked PRs`].filter(Boolean).join(', ') }})
              </span>
            </span>
          </p>
          <ScrollArea v-if="proposalChanges.length" class="mt-2 [&>[data-slot=scroll-area-viewport]]:max-h-80">
            <ul class="space-y-1.5 pr-2">
              <li v-for="c in proposalChanges" :key="c.id" class="rounded-md border bg-background/70 p-2">
                <label class="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox :model-value="picked.has(c.id)" class="mt-0.5" @update:model-value="togglePick(c.id)" />
                  <span class="w-24 shrink-0 font-medium">{{ c.label }}</span>
                  <span v-if="!c.diff" class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span class="text-muted-foreground line-through decoration-destructive/60">{{ c.before || 'None' }}</span>
                    <span class="text-muted-foreground">→</span>
                    <span class="text-success">{{ c.after }}</span>
                  </span>
                  <span v-else class="text-xs text-muted-foreground">
                    +{{ c.diff.filter((l) => l.kind === 'add').length }} −{{ c.diff.filter((l) => l.kind === 'del').length }} lines
                  </span>
                </label>
                <pre v-if="c.diff" class="mt-1.5 max-h-60 overflow-auto rounded bg-muted/60 py-1 font-mono text-[11px] leading-relaxed"><template v-for="(l, i) in c.diff" :key="i"><span
                  v-if="l.kind === 'gap'" class="block px-2 text-muted-foreground/60">⋯</span><span
                  v-else :class="['block px-2 whitespace-pre-wrap', l.kind === 'add' && 'bg-success/15 text-success', l.kind === 'del' && 'bg-destructive/12 text-destructive line-through decoration-destructive/40', l.kind === 'same' && 'text-muted-foreground']">{{ l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  ' }}{{ l.text }}</span></template></pre>
              </li>
            </ul>
          </ScrollArea>
          <div class="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" class="h-7" @click="proposal = null">Discard</Button>
            <Button v-if="proposalChanges.length" size="sm" class="h-7" :disabled="!picked.size" @click="applyProposal">
              Apply {{ picked.size }} change{{ picked.size === 1 ? '' : 's' }}
            </Button>
          </div>
        </div>
        <div v-else-if="drafted" class="flex items-start gap-2 border-t border-primary/20 px-3 py-2 text-xs text-muted-foreground">
          <PhSparkle class="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p class="min-w-0 flex-1">
            {{ drafted.rationale }}
            <span class="opacity-70">
              (Read: {{ [drafted.used.pr, drafted.used.slack && 'the Slack thread', drafted.used.claudeMd && `${drafted.used.claudeMd} CLAUDE.md`, drafted.used.guide && `the ${project?.key} guide`].filter(Boolean).join(', ') || 'your request' }})
            </span>
          </p>
          <button v-if="undo" type="button" class="flex shrink-0 items-center gap-1 hover:text-foreground" @click="undoDraft"><PhArrowCounterClockwise /> Undo</button>
        </div>
      </AiPromptBox>

      <div class="mx-4 mt-3 h-px bg-border" />

      <!-- Expanded: the description fills the window; otherwise the body scrolls -->
      <div v-if="prefs.expanded" class="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3">
        <textarea
          ref="titleInput"
          v-model="summary"
          rows="1"
          placeholder="Issue title"
          maxlength="254"
          class="field-sizing-content resize-none bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
          @keydown.enter.exact.prevent
        />
        <div data-inline-images class="flex min-h-0 flex-1 flex-col">
          <MarkdownEditor v-model="description" placeholder="Add description… (paste or drop images)" state-key="jira-composer" fill :images="imagePreviews" />
        </div>
      </div>
      <ScrollArea v-else class="min-h-0 flex-1">
        <div class="flex flex-col gap-2 px-4 pt-3">
          <textarea
            ref="titleInput"
            v-model="summary"
            rows="1"
            placeholder="Issue title"
            maxlength="254"
            class="field-sizing-content resize-none bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
            @keydown.enter.exact.prevent
          />
          <div data-inline-images>
            <MarkdownEditor v-model="description" placeholder="Add description… (paste or drop images)" state-key="jira-composer" :height="200" :images="imagePreviews" />
          </div>
        </div>
      </ScrollArea>

      <!-- Attachments: pasted or dropped images -->
      <div v-if="attach.images.value.length" class="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <HoverCard v-for="img in attach.images.value" :key="img.id" :open-delay="150">
          <HoverCardTrigger as-child>
            <span class="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border bg-background pr-1 pl-1 text-xs">
              <img :src="img.url" alt="" class="size-5 rounded-sm object-cover" />
              <span class="min-w-0 truncate">{{ img.name }}</span>
              <span class="shrink-0 whitespace-nowrap text-muted-foreground">{{ fileSize(img.size) }}</span>
              <button type="button" class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" :aria-label="`Remove ${img.name}`" @click="removeImage(img)">
                <PhX class="size-3" />
              </button>
            </span>
          </HoverCardTrigger>
          <HoverCardContent side="top" class="w-auto max-w-md p-1.5">
            <img :src="img.url" :alt="img.name" class="max-h-72 rounded" />
          </HoverCardContent>
        </HoverCard>
        <span class="text-xs text-muted-foreground">Attached to the issue{{ !editKey ? ' (Claude sees them too)' : '' }}</span>
      </div>

      <!-- Properties -->
      <div class="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <template v-if="loading">
          <Skeleton v-for="i in 6" :key="i" class="h-7 w-20" />
        </template>
        <template v-else-if="project">
          <JiraFieldChip v-model="typeModel" :field="typeField" :project="project.key" :suggested="suggested.has('issuetype')" @touched="untouch('issuetype')" />
          <JiraFieldChip
            v-for="f in visible"
            :key="f.key"
            v-model="values[f.key]"
            :field="f"
            :known="known[f.key]"
            :project="project.key"
            :issue-key="editKey ?? undefined"
            :invalid="f.required && isEmpty(values[f.key]) && !!summary"
            :suggested="suggested.has(f.key)"
            @learn="(o) => learn(f.key, o)"
            @touched="untouch(f.key)"
          />
          <Popover v-if="more.length" v-model:open="moreOpen">
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-7 text-muted-foreground" title="More fields"><PhDotsThree weight="bold" /></Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-64 gap-0 p-0">
              <input v-model="moreQuery" placeholder="Show a field…" class="h-9 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground" />
              <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-72">
                <div class="p-1">
                  <button
                    v-for="f in more.filter((x) => !moreQuery || x.name.toLowerCase().includes(moreQuery.toLowerCase()))"
                    :key="f.key"
                    type="button"
                    class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent"
                    @click="toggleField(f)"
                  >
                    <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                    <PhCheck v-if="extraKeys.includes(f.key)" class="size-4 text-primary" />
                  </button>
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </template>
        <p v-else class="text-sm text-muted-foreground">Pick a project. Set a default in Settings → Jira.</p>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-3 border-t px-4 py-3">
        <a v-if="editKey && url" :href="url" target="_blank" rel="noopener" class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <PhArrowSquareOut /> Open in Jira
        </a>
        <span class="flex-1" />
        <label v-if="ctx.slackItemId && !editKey" class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch v-model="replyInThread" /> Reply in the Slack thread
        </label>
        <label v-if="!editKey" class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch v-model="prefs.createMore" /> Create more
        </label>
        <label v-if="editKey && commentText" class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground" :title="commentText">
          <Switch v-model="postComment" /> Comment what Claude changed
        </label>
        <span v-if="editKey && changeCount" class="text-xs text-muted-foreground">{{ changeCount }} change{{ changeCount === 1 ? '' : 's' }}</span>
        <Button size="sm" :disabled="!canSubmit" :title="blockedReason ? blockedReason : '⌘↵'" @click="submit">
          <PhCircleNotch v-if="busy" class="animate-spin" />
          {{ editKey ? 'Save changes' : 'Create issue' }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
