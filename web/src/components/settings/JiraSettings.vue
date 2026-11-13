<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { PhArrowClockwise, PhKanban } from '@phosphor-icons/vue'
import type { JiraConfig, JiraIssueTypeMeta, JiraProjectMeta } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import MultiPicker from '@/components/MultiPicker.vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const st = useSettings()
const jira = computed(() => st.s?.jira ?? null)
const draft = ref<JiraConfig | null>(null)

const DEFAULTS: JiraConfig = {
  baseUrl: 'https://your-site.atlassian.net',
  email: '',
  apiToken: '',
  projectKeys: [],
  myJql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
  create: { projectKey: '', issueType: 'Task', assignToMe: true },
}

const details = computed(() => {
  const j = jira.value
  if (!j) return []
  return [
    { label: 'Site', value: j.baseUrl },
    { label: 'Email', value: j.email },
    { label: 'Project keys', value: j.projectKeys.join(', ') || 'Any' },
    { label: 'My tasks JQL', value: j.myJql, mono: true },
    {
      label: 'New issues',
      value: [j.create.projectKey || 'No default project', j.create.issueType, j.create.assignToMe && 'assigned to me'].filter(Boolean).join(' · '),
    },
  ]
})

// ---- Projects and issue types, loaded from Jira with the credentials in the form
const projects = ref<JiraProjectMeta[]>([])
const projectsLoading = ref(false)
const projectsError = ref('')
const types = ref<JiraIssueTypeMeta[]>([])
const canAsk = computed(() => !!draft.value?.baseUrl && !!draft.value.email && (!!draft.value.apiToken || !!draft.value.hasToken))

async function loadProjects() {
  if (!draft.value || !canAsk.value) return
  projectsLoading.value = true
  projectsError.value = ''
  try {
    projects.value = await api.jiraAllProjects(draft.value.baseUrl, draft.value.email, draft.value.apiToken)
  } catch (e) {
    projects.value = []
    projectsError.value = (e as Error).message
  } finally {
    projectsLoading.value = false
  }
}
watchDebounced(() => [draft.value?.baseUrl, draft.value?.email, draft.value?.apiToken, !!draft.value], loadProjects, { debounce: 600, immediate: true })

const projectOptions = computed(() => projects.value.map((p) => ({ value: p.key, label: p.key, detail: p.name, iconUrl: p.avatarUrl })))
/** The default project comes from the chosen projects (or any project when none are chosen) */
const defaultProjects = computed(() => {
  const keys = draft.value?.projectKeys ?? []
  const list = keys.length ? keys.map((k) => projects.value.find((p) => p.key === k) ?? { key: k, name: k, avatarUrl: null }) : projects.value
  const current = draft.value?.create.projectKey
  return current && !list.some((p) => p.key === current) ? [{ key: current, name: current, avatarUrl: null }, ...list] : list
})
// A default project that's no longer chosen moves to the first chosen one
watch(
  () => draft.value?.projectKeys,
  (keys) => {
    if (draft.value && keys?.length && !keys.includes(draft.value.create.projectKey)) draft.value.create.projectKey = keys[0]
  },
  { deep: true },
)
watchDebounced(
  () => [draft.value?.create.projectKey, canAsk.value],
  async () => {
    const d = draft.value
    types.value = []
    if (!d?.create.projectKey || !canAsk.value) return
    types.value = await api.jiraIssueTypes(d.baseUrl, d.email, d.apiToken, d.create.projectKey).catch(() => [])
  },
  { debounce: 300, immediate: true },
)
const typeNames = computed(() => {
  const names = types.value.map((t) => t.name)
  const current = draft.value?.create.issueType
  return current && !names.includes(current) ? [current, ...names] : names
})

const check = () => api.testJira(draft.value!.baseUrl, draft.value!.email, draft.value!.apiToken)
const test = () => st.run('', async () => `Connected as ${(await check()).displayName}`)
async function submit() {
  // Check the credentials first (errors toast), then save without a second "connected" toast
  if (!(await st.run('', async () => void (await check())))) return false
  return st.saveSection({ jira: draft.value }, jira.value ? 'Jira settings saved' : 'Jira connected')
}
</script>

<template>
  <ConnectionCard
    title="Jira"
    :icon="PhKanban"
    :connected="!!jira"
    :details="details"
    :on-open="() => (draft = clone(jira ?? DEFAULTS))"
    :on-test="test"
    :on-submit="submit"
    :on-disconnect="() => st.saveSection({ jira: null }, 'Jira disconnected')"
  >
    <template #description>Your Jira tasks, issue status on PRs, transitions, and issues created from Slack.</template>
    <template #dialog-description>
      Create an API token at
      <a class="text-primary hover:underline" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">id.atlassian.com → API tokens</a>.
    </template>
    <template v-if="draft" #form>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Site URL"><Input v-model="draft.baseUrl" required /></Field>
        <Field label="Email"><Input v-model="draft.email" type="email" required /></Field>
        <Field label="API token" class="col-span-2">
          <Input v-model="draft.apiToken" type="password" class="font-mono" :required="!draft.hasToken" :placeholder="draft.hasToken ? '•••••••• stored (leave blank to keep)' : 'API token'" />
        </Field>
        <Field
          label="Projects"
          class="col-span-2"
          :hint="projectsError ? `Couldn't load projects: ${projectsError}` : !canAsk ? 'Enter the site, email and token to load your projects.' : 'Issue keys from these projects are found in PRs, and new issues go to one of them. None = any project.'"
        >
          <div class="flex gap-2">
            <MultiPicker v-model="draft.projectKeys" :options="projectOptions" :loading="projectsLoading" placeholder="Any project" empty-text="No projects loaded" />
            <Button type="button" variant="outline" size="icon" class="shrink-0" :disabled="!canAsk || projectsLoading" title="Reload projects from Jira" @click="loadProjects">
              <PhArrowClockwise :class="{ 'animate-spin': projectsLoading }" />
            </Button>
          </div>
        </Field>
        <Field label="“My tasks” JQL" hint="Issues shown as yours on the Jira page and the overview." class="col-span-2">
          <Textarea v-model="draft.myJql" rows="3" spellcheck="false" class="min-h-0 resize-y font-mono text-xs" />
        </Field>
      </div>
      <Separator />
      <div class="grid grid-cols-3 items-end gap-3">
        <Field label="Default project">
          <Select v-model="draft.create.projectKey">
            <SelectTrigger class="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in defaultProjects" :key="p.key" :value="p.key">
                <img v-if="p.avatarUrl" :src="p.avatarUrl" alt="" class="size-4 rounded-sm" />
                <span class="font-medium">{{ p.key }}</span>
                <span v-if="p.name !== p.key" class="truncate text-muted-foreground">{{ p.name }}</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default type">
          <Select v-model="draft.create.issueType">
            <SelectTrigger class="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in typeNames" :key="t" :value="t">
                <img v-if="types.find((x) => x.name === t)?.iconUrl" :src="types.find((x) => x.name === t)!.iconUrl!" alt="" class="size-4" />
                {{ t }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Label class="h-9 cursor-pointer gap-2 font-normal"><Checkbox v-model="draft.create.assignToMe" /> Assign to me</Label>
      </div>
    </template>
  </ConnectionCard>
</template>
