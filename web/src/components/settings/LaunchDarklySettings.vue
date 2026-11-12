<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCircleNotch, PhFlag } from '@phosphor-icons/vue'
import type { LaunchDarklyConfig } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

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

/** Environments ordered by stage: production, pre-production / staging, development, local, then the rest */
const stage = (e: string) =>
  /^prod(uction)?$/i.test(e) ? 0 : /pre.?prod|stag|uat|qa|test/i.test(e) ? 1 : /^dev/i.test(e) ? 2 : /local/i.test(e) ? 3 : 4
const byStage = (envs: string[]) => [...envs].sort((a, b) => stage(a) - stage(b))
/** The project's environments, loaded from LaunchDarkly, to pick from */
const available = ref<string[]>([])
const loadingEnvs = ref(false)
const envError = ref('')
async function loadEnvs() {
  const d = draft.value
  if (!d?.projectKey || !(d.apiToken || d.hasToken)) return
  loadingEnvs.value = true
  envError.value = ''
  try {
    const r = await api.testLaunchDarkly({ apiToken: d.apiToken, baseUrl: d.baseUrl, projectKey: d.projectKey })
    available.value = byStage(r.environments)
    if (!d.environments.length) d.environments = available.value.includes('production') ? ['production'] : [...available.value]
  } catch (e) {
    available.value = []
    envError.value = (e as Error).message
  } finally {
    loadingEnvs.value = false
  }
}
/** Ticking keeps the list in stage order */
function toggleEnv(env: string, on: boolean) {
  const d = draft.value!
  const set = new Set(d.environments)
  if (on) set.add(env)
  else set.delete(env)
  d.environments = [...available.value.filter((e) => set.has(e)), ...[...set].filter((e) => !available.value.includes(e))]
}
function open() {
  draft.value = { ...clone(DEFAULTS), ...clone(ld.value ?? DEFAULTS) }
  available.value = []
  envError.value = ''
  // With a stored token, list the environments straight away
  if (ld.value) loadEnvs()
}

const test = () =>
  st.run('', async () => {
    const d = draft.value!
    const r = await api.testLaunchDarkly({ apiToken: d.apiToken, baseUrl: d.baseUrl, projectKey: d.projectKey })
    available.value = byStage(r.environments)
    if (!d.environments.length) d.environments = available.value.includes('production') ? ['production'] : [...available.value]
    const unknown = d.environments.filter((e) => !r.environments.includes(e))
    const missing = r.environments.filter((e) => !d.environments.includes(e))
    // Unknown keys would be skipped silently; say so
    if (unknown.length) throw new Error(`Project “${r.project}” has no environment ${unknown.join(', ')}. Its environments: ${r.environments.join(', ')}`)
    return `Project “${r.project}”: showing ${d.environments.join(', ')}${missing.length ? ` (also available: ${missing.join(', ')})` : ''}`
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
    :on-open="open"
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
        <Field label="Project key" class="col-span-2">
          <Input v-model="draft.projectKey" class="font-mono" required placeholder="default" @change="loadEnvs" />
        </Field>
        <Field label="Environments to show" class="col-span-2" hint="Shown in this order on PRs and releases; the first one sets the flag icon's colour">
          <div v-if="available.length" class="flex flex-wrap gap-2">
            <Label
              v-for="e in available"
              :key="e"
              class="cursor-pointer gap-2 rounded-md border px-2.5 py-1.5 font-mono text-xs font-normal has-data-checked:border-primary has-data-checked:bg-primary/10"
            >
              <Checkbox :model-value="draft.environments.includes(e)" @update:model-value="(v) => toggleEnv(e, !!v)" />{{ e }}
            </Label>
          </div>
          <p v-for="e in draft.environments.filter((x) => available.length && !available.includes(x))" :key="e" class="text-xs text-destructive">
            “{{ e }}” isn't an environment of this project
            <button type="button" class="ml-1 underline" @click="toggleEnv(e, false)">remove</button>
          </p>
          <div v-if="!available.length" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Button type="button" variant="outline" size="xs" :disabled="loadingEnvs || !draft.projectKey || !(draft.apiToken || draft.hasToken)" @click="loadEnvs">
              <PhCircleNotch v-if="loadingEnvs" class="animate-spin" /> Load environments
            </Button>
            <span v-if="envError" class="text-destructive">{{ envError }}</span>
            <span v-else>Enter the token and project key first.</span>
          </div>
        </Field>
        <Field label="Site" class="col-span-2" hint="Change only for a federal or EU instance">
          <Input v-model="draft.baseUrl" class="font-mono" placeholder="https://app.launchdarkly.com" />
        </Field>
      </div>
    </template>
  </ConnectionCard>
</template>
