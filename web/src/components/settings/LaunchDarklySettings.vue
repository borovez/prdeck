<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhFlag } from '@phosphor-icons/vue'
import type { LaunchDarklyConfig } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone, splitList } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'

const st = useSettings()
const ld = computed(() => st.s?.launchdarkly ?? null)
const draft = ref<LaunchDarklyConfig | null>(null)

const DEFAULTS: LaunchDarklyConfig = { apiToken: '', baseUrl: 'https://app.launchdarkly.com', projectKey: '', environments: ['production'] }

const details = computed(() => {
  const s = ld.value
  if (!s) return []
  return [
    { label: 'Project', value: s.projectKey, mono: true },
    { label: 'Environments', value: s.environments.join(', ') || '—', mono: true },
    { label: 'Site', value: s.baseUrl },
    { label: 'Access', value: 'Read only (flag states are only read)' },
  ]
})

const test = () =>
  st.run('', async () => {
    const d = draft.value!
    const r = await api.testLaunchDarkly({ apiToken: d.apiToken, baseUrl: d.baseUrl, projectKey: d.projectKey })
    // Fill the environments from the project when none are set
    if (!d.environments.length) d.environments = r.environments
    return `Project “${r.project}”: environments ${r.environments.join(', ')}`
  })
/** Where access tokens are created (follows the Site field) */
const tokenPage = computed(() => `${(draft.value?.baseUrl || 'https://app.launchdarkly.com').replace(/\/+$/, '')}/settings/authorization`)
const submit = () => st.saveSection({ launchdarkly: draft.value }, ld.value ? 'LaunchDarkly settings saved' : 'LaunchDarkly connected')
</script>

<template>
  <ConnectionCard
    title="LaunchDarkly"
    :icon="PhFlag"
    :connected="!!ld"
    :details="details"
    :on-open="() => (draft = { ...clone(DEFAULTS), ...clone(ld ?? DEFAULTS) })"
    :on-test="test"
    :on-submit="submit"
    :on-disconnect="() => st.saveSection({ launchdarkly: null }, 'LaunchDarkly disconnected')"
  >
    <template #description>
      Shows whether the feature flags a PR names are on or off, per environment. Read only. PRs name flags in their description:
      <code>Feature flag: my-flag</code>, or “behind the <code>`my-flag`</code> LaunchDarkly flag”.
    </template>
    <template #dialog-description>
      Open
      <a class="text-primary hover:underline" :href="tokenPage" target="_blank" rel="noopener">LaunchDarkly → Organization settings → Authorization</a>,
      create an <b>access token</b> with the <b>Reader</b> role and paste it below. PR Deck only reads flags.
    </template>
    <template v-if="draft" #form>
      <Field label="Access token">
        <Input v-model="draft.apiToken" type="password" class="font-mono" :required="!draft.hasToken" :placeholder="draft.hasToken ? '•••••••• stored (leave blank to keep)' : 'api-…'" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Project key"><Input v-model="draft.projectKey" class="font-mono" required placeholder="default" /></Field>
        <Field label="Environments" hint="Keys, comma separated, in display order. Test fills them in.">
          <Input
            :model-value="draft.environments.join(', ')"
            class="font-mono"
            placeholder="production, staging"
            @change="draft.environments = splitList(($event.target as HTMLInputElement).value)"
          />
        </Field>
        <Field label="Site" class="col-span-2" hint="Change only for a federal or EU instance">
          <Input v-model="draft.baseUrl" class="font-mono" placeholder="https://app.launchdarkly.com" />
        </Field>
      </div>
    </template>
  </ConnectionCard>
</template>
