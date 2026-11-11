<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhSparkle } from '@phosphor-icons/vue'
import type { AiConfig } from '@shared/types'
import { useSettings } from '@/stores/settings'
import { clone } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

const st = useSettings()
const ai = computed(() => st.s?.ai ?? null)
const draft = ref<AiConfig | null>(null)

const MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
]

const details = computed(() =>
  ai.value
    ? [
        { label: 'API key', value: ai.value.hasKey ? 'Stored' : "Not set: uses ANTHROPIC_API_KEY or the server's ant auth login profile" },
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
    connect-label="Configure"
    dialog-title="Claude"
    disconnect-label="Remove key"
    disconnect-description="The stored API key is deleted. Drafting falls back to ANTHROPIC_API_KEY or your ant auth login profile."
    :on-open="() => (draft = clone(ai!))"
    :on-submit="() => st.saveSection({ ai: draft! }, 'Claude settings saved')"
    :on-disconnect="() => st.saveSection({ ai: { ...ai!, apiKey: '', hasKey: false } }, 'API key removed')"
  >
    <template #description>Drafts Jira tasks from Slack threads.</template>
    <template #dialog-description>Leave the key blank to use <code>ANTHROPIC_API_KEY</code> or your <code>ant auth login</code> profile from the server's environment.</template>
    <template v-if="draft" #form>
      <Field label="API key">
        <Input v-model="draft.apiKey" type="password" class="font-mono" :placeholder="draft.hasKey ? '•••••••• stored (leave blank to keep)' : 'sk-ant-… (optional)'" />
      </Field>
      <Field label="Model">
        <NativeSelect v-model="draft.model" class="w-full">
          <NativeSelectOption v-for="m in MODELS" :key="m.value" :value="m.value">{{ m.label }}</NativeSelectOption>
        </NativeSelect>
      </Field>
    </template>
  </ConnectionCard>
</template>
