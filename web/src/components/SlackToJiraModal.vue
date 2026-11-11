<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhArrowSquareOut, PhCheckCircle, PhCircleNotch, PhSparkle, PhWarning } from '@phosphor-icons/vue'
import type { JiraDraft, JiraRequiredField } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { watchDebounced } from '@vueuse/core'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

const deck = useDeck()
const item = computed(() => deck.slackToJira)
const open = computed({ get: () => !!item.value, set: (v) => !v && (deck.slackToJira = null) })

const context = ref('')
const projectKey = ref('')
const draft = ref<JiraDraft | null>(null)
const thread = ref('')
const replyInThread = ref(true)
const busy = ref<'draft' | 'create' | null>(null)
const error = ref('')
const created = ref<{ key: string; url: string; replied: boolean } | null>(null)

// ---- Fields the project requires on create (e.g. a required custom field), asked from Jira per project + type
const required = ref<JiraRequiredField[]>([])
/** Chosen values: option id(s) or text, by field key */
const values = ref<Record<string, string>>({})
const loadingFields = ref(false)
/** Defaults from Settings → Jira → extra fields JSON, by field key */
const settingDefaults = ref<Record<string, string>>({})
/** Last values used, per project, so the next issue starts with them */
const remembered = useLayout().view('jira-create', { fields: {} as Record<string, Record<string, string>> })

watchDebounced(
  () => [open.value && !!draft.value, projectKey.value.trim().toUpperCase(), draft.value?.issueType] as const,
  async ([active, project, type]) => {
    required.value = []
    if (!active || !project || !type) return
    loadingFields.value = true
    try {
      required.value = await api.jiraRequiredFields(project, type)
      const last = remembered.fields[project] ?? {}
      for (const f of required.value) values.value[f.key] ??= last[f.key] ?? settingDefaults.value[f.key] ?? ''
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loadingFields.value = false
    }
  },
  { debounce: 300, immediate: true },
)
const missingRequired = computed(() => required.value.filter((f) => !values.value[f.key]))
/** In Jira's shape: {id} for a select, [{id}] for a multi-select, text otherwise */
const fieldPayload = () =>
  Object.fromEntries(
    required.value.map((f) => {
      const v = values.value[f.key]
      return [f.key, f.options.length ? (f.multiple ? [{ id: v }] : { id: v }) : v]
    }),
  )

watch(item, async (it) => {
  if (!it) return
  context.value = ''
  draft.value = null
  thread.value = ''
  error.value = ''
  created.value = null
  values.value = {}
  const jira = (await api.settings().catch(() => null))?.jira
  if (!projectKey.value) projectKey.value = jira?.create.projectKey ?? ''
  settingDefaults.value = {}
  try {
    for (const [k, v] of Object.entries(JSON.parse(jira?.create.extraFieldsJson || '{}') as Record<string, unknown>))
      settingDefaults.value[k] = typeof v === 'object' && v && 'id' in v ? String((v as { id: unknown }).id) : String(v)
  } catch {
    /* invalid JSON is reported on create */
  }
})

async function generate() {
  busy.value = 'draft'
  error.value = ''
  try {
    const r = await api.slackDraft(item.value!.id, context.value, projectKey.value)
    draft.value = r.draft
    thread.value = r.thread
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}
function blank() {
  draft.value = { summary: '', description: `${item.value!.text}\n\n${context.value}`.trim(), issueType: 'Task', labels: [], rationale: '' }
}
async function create() {
  busy.value = 'create'
  error.value = ''
  try {
    const d = draft.value!
    created.value = await api.createJira({
      projectKey: projectKey.value,
      issueType: d.issueType,
      summary: d.summary,
      description: d.description,
      labels: d.labels,
      slackItemId: item.value!.id,
      replyInThread: replyInThread.value,
      fields: fieldPayload(),
    })
    remembered.fields[projectKey.value.trim().toUpperCase()] = { ...values.value }
    await deck.load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent v-if="item" class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Create Jira task from Slack</DialogTitle>
        <DialogDescription>{{ item.userName }} · {{ item.channelName }}</DialogDescription>
      </DialogHeader>

      <blockquote class="rounded-lg border-l-4 border-primary/50 bg-muted/60 p-3 text-sm whitespace-pre-line">{{ item.text }}</blockquote>

      <template v-if="created">
        <Alert>
          <PhCheckCircle class="text-success" />
          <AlertDescription>
            <span>Created <a :href="created.url" target="_blank" class="font-mono text-primary hover:underline">{{ created.key }}</a><template v-if="created.replied"> and replied in the Slack thread</template>.</span>
          </AlertDescription>
        </Alert>
        <DialogFooter><Button @click="open = false">Close</Button></DialogFooter>
      </template>

      <template v-else-if="!draft">
        <div class="grid gap-2">
          <Label for="ctx">Extra context for Claude (optional)</Label>
          <Textarea id="ctx" v-model="context" rows="5" placeholder="e.g. Affects the Collection report for operator X; repro steps; which repo; priority…" />
          <p class="text-xs text-muted-foreground">Claude reads the whole Slack thread plus this note and drafts the issue. You can edit everything before it's created.</p>
        </div>
        <Alert v-if="error" variant="destructive"><PhWarning /><AlertDescription>{{ error }}</AlertDescription></Alert>
        <DialogFooter>
          <Button variant="ghost" @click="open = false">Cancel</Button>
          <Button variant="outline" @click="blank">Write manually</Button>
          <Button :disabled="busy === 'draft'" @click="generate">
            <PhCircleNotch v-if="busy === 'draft'" class="animate-spin" /><PhSparkle v-else />
            Draft with Claude
          </Button>
        </DialogFooter>
      </template>

      <template v-else>
        <div class="grid grid-cols-3 gap-3">
          <div class="grid gap-1.5">
            <Label>Project</Label>
            <Input v-model="projectKey" class="font-mono" placeholder="PROJ" />
          </div>
          <div class="grid gap-1.5">
            <Label>Type</Label>
            <NativeSelect v-model="draft.issueType" class="w-full">
              <NativeSelectOption v-for="t in ['Task', 'Bug', 'Story', 'Improvement']" :key="t" :value="t">{{ t }}</NativeSelectOption>
            </NativeSelect>
          </div>
          <div class="grid gap-1.5">
            <Label>Labels</Label>
            <Input :model-value="draft.labels.join(', ')" @change="draft.labels = ($event.target as HTMLInputElement).value.split(',').map((l) => l.trim()).filter(Boolean)" />
          </div>
        </div>
        <div v-if="required.length || loadingFields" class="grid grid-cols-3 gap-3">
          <div v-for="f in required" :key="f.key" class="grid gap-1.5">
            <Label>{{ f.name }} <span class="text-destructive">*</span></Label>
            <NativeSelect v-if="f.options.length" v-model="values[f.key]" class="w-full">
              <NativeSelectOption value="" disabled>Choose…</NativeSelectOption>
              <NativeSelectOption v-for="o in f.options" :key="o.id" :value="o.id">{{ o.label }}</NativeSelectOption>
            </NativeSelect>
            <Input v-else v-model="values[f.key]" />
          </div>
          <p v-if="loadingFields" class="flex items-center gap-1.5 self-end text-xs text-muted-foreground"><PhCircleNotch class="animate-spin" /> Checking required fields…</p>
        </div>
        <div class="grid gap-1.5">
          <Label>Summary</Label>
          <Input v-model="draft.summary" />
        </div>
        <div class="grid gap-1.5">
          <Label>Description (Markdown)</Label>
          <Textarea v-model="draft.description" rows="12" class="font-mono text-xs" />
        </div>
        <p v-if="draft.rationale" class="flex items-start gap-1 text-xs text-muted-foreground"><PhSparkle class="mt-0.5 shrink-0" /> {{ draft.rationale }}</p>
        <Collapsible v-if="thread">
          <CollapsibleTrigger class="text-xs text-muted-foreground hover:text-foreground">Show the Slack context Claude used</CollapsibleTrigger>
          <CollapsibleContent>
            <pre class="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap">{{ thread }}</pre>
          </CollapsibleContent>
        </Collapsible>
        <Label class="cursor-pointer gap-2 font-normal">
          <Checkbox v-model="replyInThread" /> Reply in the Slack thread with the issue link
        </Label>
        <Alert v-if="error" variant="destructive"><PhWarning /><AlertDescription>{{ error }}</AlertDescription></Alert>
        <DialogFooter>
          <Button variant="ghost" @click="draft = null">Back</Button>
          <Button v-if="item.permalink" variant="outline" as="a" :href="item.permalink" target="_blank"><PhArrowSquareOut /> Slack</Button>
          <Button
            :disabled="busy === 'create' || !draft.summary || !projectKey || loadingFields || missingRequired.length > 0"
            :title="missingRequired.length ? `Choose ${missingRequired.map((f) => f.name).join(', ')}` : undefined"
            @click="create"
          >
            <PhCircleNotch v-if="busy === 'create'" class="animate-spin" />
            Create in Jira
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
