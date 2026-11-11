<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhSparkle } from '@phosphor-icons/vue'
import type { AiConfig } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

const st = useSettings()
const ai = computed(() => st.s?.ai ?? null)
const draft = ref<AiConfig | null>(null)
/** The server has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN of its own, so a stored key is optional */
const envKey = ref(false)
onMounted(async () => (envKey.value = (await api.aiInfo().catch(() => ({ env: false }))).env))

const MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
]

const check = () => api.testAi(draft.value!.apiKey, draft.value!.model)
const test = () => st.run('', async () => {
  const r = await check()
  return `Works: ${r.model} via ${r.source === 'key' ? 'API key' : 'server environment'}`
})
async function submit() {
  // Check first (a model lookup, no tokens), then save without a second toast
  if (!(await st.run('', async () => void (await check())))) return false
  return st.saveSection({ ai: draft.value! }, 'Claude settings saved')
}

const details = computed(() =>
  ai.value
    ? [
        {
          label: 'API key',
          value: ai.value.hasKey
            ? 'Stored'
            : envKey.value
              ? "Not stored: uses the server's ANTHROPIC_API_KEY"
              : 'Not set: drafting Jira tasks won\'t work until you add one',
        },
        { label: 'Model', value: MODELS.find((m) => m.value === ai.value!.model)?.label ?? ai.value.model },
      ]
    : [],
)
</script>

<template>
  <ConnectionCard
    title="Claude"
    :icon="PhSparkle"
    :connected="!!ai?.hasKey"
    :details="details"
    connect-label="Add API key"
    dialog-title="Claude"
    disconnect-label="Remove key"
    disconnect-description="The stored API key is deleted. Drafting then only works if the server has ANTHROPIC_API_KEY set."
    :on-open="() => (draft = clone(ai!))"
    :on-test="test"
    :on-submit="submit"
    :on-disconnect="() => st.saveSection({ ai: { ...ai!, apiKey: '', hasKey: false } }, 'API key removed')"
  >
    <template #description>Drafts Jira tasks from Slack threads.</template>
    <template #dialog-description>
      Create a key at
      <a class="text-primary hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API keys</a>
      and paste it below.
      <template v-if="envKey"> The server already has <code>ANTHROPIC_API_KEY</code>, so you can leave it blank.</template>
    </template>
    <template v-if="draft" #form>
      <Field label="API key">
        <Input
          v-model="draft.apiKey"
          type="password"
          class="font-mono"
          :required="!draft.hasKey && !envKey"
          :placeholder="draft.hasKey ? '•••••••• stored (leave blank to keep)' : envKey ? 'sk-ant-… (optional)' : 'sk-ant-…'"
        />
      </Field>
      <Field label="Model">
        <NativeSelect v-model="draft.model" class="w-full">
          <NativeSelectOption v-for="m in MODELS" :key="m.value" :value="m.value">{{ m.label }}</NativeSelectOption>
        </NativeSelect>
      </Field>
    </template>
  </ConnectionCard>
</template>
