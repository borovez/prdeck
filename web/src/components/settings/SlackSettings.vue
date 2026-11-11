<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhSlackLogo } from '@phosphor-icons/vue'
import type { SlackConfig } from '@shared/types'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import { clone, splitList } from '@/utils/format'
import ConnectionCard from '@/components/ConnectionCard.vue'
import Field from '@/components/Field.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const st = useSettings()
const slack = computed(() => st.s?.slack ?? null)
const draft = ref<SlackConfig | null>(null)

const DEFAULTS: SlackConfig = {
  token: '',
  userId: null,
  teamUrl: null,
  lookbackDays: 7,
  maxConversations: 40,
  includeSaved: true,
  todoReactions: ['todo', 'eyes', 'bookmark'],
}
const SCOPES =
  'search:read, im:history, mpim:history, im:read, mpim:read, channels:history, groups:history, users:read, stars:read, reactions:read, chat:write'

const details = computed(() => {
  const s = slack.value
  if (!s) return []
  return [
    { label: 'Workspace', value: s.teamUrl ?? '—' },
    { label: 'User', value: s.userId ?? '—', mono: true },
    { label: 'Look back', value: `${s.lookbackDays} days, up to ${s.maxConversations} DMs / groups` },
    { label: 'Saved messages', value: s.includeSaved ? 'Included' : 'Not included' },
    { label: 'Todo reactions', value: s.todoReactions.map((r) => `:${r}:`).join(' ') || 'None' },
  ]
})

const test = () => st.run('', async () => {
  const r = await api.testSlack(draft.value!.token)
  return `Connected as ${r.user} @ ${r.team}`
})
// Saving checks the token on the server (auth.test), so no separate test first
const submit = () => st.saveSection({ slack: draft.value }, slack.value ? 'Slack settings saved' : 'Slack connected')
</script>

<template>
  <ConnectionCard
    title="Slack"
    :icon="PhSlackLogo"
    :connected="!!slack"
    :details="details"
    :on-open="() => (draft = clone(slack ?? DEFAULTS))"
    :on-test="test"
    :on-submit="submit"
    :on-disconnect="() => st.saveSection({ slack: null }, 'Slack disconnected')"
  >
    <template #description>Mentions, unanswered DMs and group chats, saved/bookmarked messages, and messages you marked with a todo reaction.</template>
    <template #dialog-description>
      Create a Slack app at <a class="text-primary hover:underline" href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> → OAuth &amp; Permissions,
      add these <b>User Token Scopes</b>, install it to your workspace, and paste the <code>xoxp-…</code> User OAuth Token.
    </template>
    <template v-if="draft" #form>
      <code class="block rounded-md bg-muted p-2 text-xs">{{ SCOPES }}</code>
      <Field label="User OAuth Token">
        <Input v-model="draft.token" type="password" class="font-mono" :required="!draft.hasToken" :placeholder="draft.hasToken ? '•••••••• stored (leave blank to keep)' : 'xoxp-…'" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Look back (days)"><Input v-model.number="draft.lookbackDays" type="number" min="1" max="60" /></Field>
        <Field label="Max DMs / groups scanned"><Input v-model.number="draft.maxConversations" type="number" min="5" max="200" /></Field>
        <Field label="Todo reactions" hint="Emoji names, comma separated">
          <Input :model-value="draft.todoReactions.join(', ')" placeholder="todo, eyes, bookmark" @change="draft.todoReactions = splitList(($event.target as HTMLInputElement).value).map((r) => r.replace(/:/g, ''))" />
        </Field>
        <Label class="cursor-pointer gap-2 self-center font-normal"><Switch v-model="draft.includeSaved" /> Include saved messages</Label>
      </div>
    </template>
  </ConnectionCard>
</template>
