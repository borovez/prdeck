<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhSparkle } from '@phosphor-icons/vue'
import type { AiConfig, AiProvider } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const st = useSettings()
const ai = computed(() => st.s?.ai ?? null)
const draft = ref<AiConfig | null>(null)
/** What the server has on its own: ANTHROPIC_API_KEY, and the path of the `claude` CLI */
const info = ref<{ env: boolean; claudeCode: string | null }>({ env: false, claudeCode: null })
onMounted(async () => (info.value = await api.aiInfo().catch(() => info.value)))

const MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
]
const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code login' },
  { value: 'api', label: 'API key' },
]

/** Drafting will work with the saved settings */
const ready = computed(() => {
  const a = ai.value
  if (!a) return false
  return a.provider === 'claude-code' ? !!info.value.claudeCode : !!a.hasKey || info.value.env
})

const check = () => api.testAi(draft.value!)
const test = () =>
  st.run('', async () => {
    const r = await check()
    const via = r.source === 'claude-code' ? 'Claude Code' : r.source === 'key' ? 'API key' : 'server environment'
    return `Works: ${r.model} via ${via}`
  })
async function submit() {
  // Check first (a tiny call or model lookup), then save without a second toast
  if (!(await st.run('', async () => void (await check())))) return false
  return st.saveSection({ ai: draft.value! }, 'Claude settings saved')
}

const details = computed(() => {
  const a = ai.value
  if (!a) return []
  const how =
    a.provider === 'claude-code'
      ? info.value.claudeCode
        ? 'Claude Code, with its own login'
        : 'Claude Code: not found on this machine'
      : a.hasKey
        ? 'API key (stored)'
        : info.value.env
          ? "API key from the server's ANTHROPIC_API_KEY"
          : 'API key: none set, so drafting won\'t work'
  return [
    { label: 'Uses', value: how },
    ...(a.provider === 'claude-code' && info.value.claudeCode ? [{ label: 'CLI', value: info.value.claudeCode, mono: true }] : []),
    { label: 'Model', value: MODELS.find((m) => m.value === a.model)?.label ?? a.model },
  ]
})
</script>

<template>
  <ConnectionCard
    title="Claude"
    :icon="PhSparkle"
    :connected="ready"
    :details="details"
    connect-label="Set up"
    dialog-title="Claude"
    disconnect-label="Remove key"
    disconnect-description="The stored API key is deleted. Drafting then only works through Claude Code or the server's ANTHROPIC_API_KEY."
    :on-open="() => (draft = clone(ai!))"
    :on-test="test"
    :on-submit="submit"
    :on-disconnect="ai?.hasKey ? () => st.saveSection({ ai: { ...ai!, apiKey: '', hasKey: false } }, 'API key removed') : undefined"
  >
    <template #description>Drafts Jira tasks from Slack threads.</template>
    <template v-if="draft" #form>
      <Field label="Connect with">
        <ToggleGroup
          :model-value="draft.provider"
          type="single"
          variant="outline"
          class="w-full"
          @update:model-value="(p) => p && (draft!.provider = p as AiProvider)"
        >
          <ToggleGroupItem v-for="p in PROVIDERS" :key="p.value" :value="p.value" class="flex-1">{{ p.label }}</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <p v-if="draft.provider === 'claude-code'" class="text-sm text-muted-foreground">
        Uses the <code>claude</code> CLI on this machine and the account it's logged into (for example your company's Claude seat). No API key needed.
        <template v-if="info.claudeCode"> Found at <code>{{ info.claudeCode }}</code>.</template>
        <span v-else class="text-destructive"> Not found: install Claude Code, or start the server with <code>CLAUDE_BIN</code> set to its path.</span>
      </p>
      <template v-else>
        <p class="text-sm text-muted-foreground">
          Create a key at
          <a class="text-primary hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API keys</a>.
          <template v-if="info.env"> The server already has <code>ANTHROPIC_API_KEY</code>, so you can leave it blank.</template>
        </p>
        <Field label="API key">
          <Input
            v-model="draft.apiKey"
            type="password"
            class="font-mono"
            :required="!draft.hasKey && !info.env"
            :placeholder="draft.hasKey ? '•••••••• stored (leave blank to keep)' : info.env ? 'sk-ant-… (optional)' : 'sk-ant-…'"
          />
        </Field>
      </template>

      <Field label="Model">
        <NativeSelect v-model="draft.model" class="w-full">
          <NativeSelectOption v-for="m in MODELS" :key="m.value" :value="m.value">{{ m.label }}</NativeSelectOption>
        </NativeSelect>
      </Field>
    </template>
  </ConnectionCard>
</template>
