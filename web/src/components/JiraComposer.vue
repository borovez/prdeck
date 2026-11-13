<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowSquareOut, PhArrowsIn, PhArrowsOut, PhCaretRight, PhCheck, PhCircleNotch, PhDotsThree, PhKanban, PhX } from '@phosphor-icons/vue'
import type { JiraFieldMeta, JiraFieldOption, JiraFieldValue, JiraIssueTypeMeta, JiraProjectMeta, JiraValueLabels } from '@shared/types'
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

function close() {
  deck.composer = null
}

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
    project.value = null
    fields.value = []
    values.value = {}
    known.value = {}
    initial.value = null
    url.value = ''
    if (t.mode === 'edit') return loadEdit(t.key)
    summary.value = t.summary ?? ''
    description.value = t.description ?? ''
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
const changeCount = computed(() => (changes.value ? Object.keys(changes.value).length - (changes.value.values ? 1 : 0) + Object.keys(changes.value.values ?? {}).length : 0))
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
      const issue = await api.jiraUpdateIssue(editKey.value, changes.value!)
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
    })
    prefs.last = {
      ...prefs.last,
      [project.value.key]: Object.fromEntries(fields.value.filter((f) => f.required).map((f) => [f.key, values.value[f.key] ?? null])),
    }
    toast.success(`Created ${issue.key}`, { description: issue.summary, action: { label: 'Open', onClick: () => (deck.selectedJiraKey = issue.key) } })
    await deck.load()
    if (prefs.createMore) {
      summary.value = ''
      description.value = ''
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
    >
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

      <ScrollArea class="min-h-0 flex-1">
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
          <MarkdownEditor v-model="description" placeholder="Add description…" state-key="jira-composer" :height="prefs.expanded ? 420 : 200" />
        </div>
      </ScrollArea>

      <!-- Properties -->
      <div class="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <template v-if="loading">
          <Skeleton v-for="i in 6" :key="i" class="h-7 w-20" />
        </template>
        <template v-else-if="project">
          <JiraFieldChip v-model="typeModel" :field="typeField" :project="project.key" />
          <JiraFieldChip
            v-for="f in visible"
            :key="f.key"
            v-model="values[f.key]"
            :field="f"
            :known="known[f.key]"
            :project="project.key"
            :issue-key="editKey ?? undefined"
            :invalid="f.required && isEmpty(values[f.key]) && !!summary"
            @learn="(o) => learn(f.key, o)"
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
        <label v-if="!editKey" class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch v-model="prefs.createMore" /> Create more
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
