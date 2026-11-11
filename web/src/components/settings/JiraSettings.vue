<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhKanban } from '@phosphor-icons/vue'
import type { JiraConfig } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone, splitList } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
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
  create: { projectKey: '', issueType: 'Task', extraFieldsJson: '', assignToMe: true },
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
    ...(j.create.extraFieldsJson ? [{ label: 'Extra fields', value: j.create.extraFieldsJson, mono: true }] : []),
  ]
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
        <Field label="Project keys to detect in PRs" hint="Empty = any KEY-123">
          <Input :model-value="draft.projectKeys.join(', ')" placeholder="PROJ, OPS" @change="draft.projectKeys = splitList(($event.target as HTMLInputElement).value).map((k) => k.toUpperCase())" />
        </Field>
        <Field label="“My tasks” JQL"><Input v-model="draft.myJql" class="font-mono text-xs" /></Field>
      </div>
      <Separator />
      <div class="grid grid-cols-3 items-end gap-3">
        <Field label="Default project" class="col-span-1"><Input v-model="draft.create.projectKey" class="font-mono" placeholder="PROJ" /></Field>
        <Field label="Default type"><Input v-model="draft.create.issueType" /></Field>
        <Label class="h-9 cursor-pointer gap-2 font-normal"><Checkbox v-model="draft.create.assignToMe" /> Assign to me</Label>
        <Field label="Extra required fields (JSON)" hint="Merged into every create call, e.g. a required custom field." class="col-span-3">
          <Input v-model="draft.create.extraFieldsJson" class="font-mono text-xs" placeholder='{"customfield_12345": {"id": "10001"}}' />
        </Field>
      </div>
    </template>
  </ConnectionCard>
</template>
