<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PhCheck, PhCircleNotch, PhPlug, PhGraph, PhTimer } from '@phosphor-icons/vue'
import { api } from '@/api'
import { useSettings } from '@/stores/settings'
import ActionBar from '@/components/ActionBar.vue'
import CodeBlock from '@/components/CodeBlock.vue'
import Field from '@/components/Field.vue'
import AiSettings from '@/components/settings/AiSettings.vue'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import JiraSettings from '@/components/settings/JiraSettings.vue'
import SlackSettings from '@/components/settings/SlackSettings.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const st = useSettings()
const mcp = ref<Awaited<ReturnType<typeof api.mcpInfo>> | null>(null)

onMounted(async () => {
  await st.load()
  mcp.value = await api.mcpInfo().catch(() => null)
})
</script>

<template>
  <div v-if="st.s" class="max-w-4xl space-y-6 pb-24">
    <GithubSettings />

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhTimer :size="20" /> Sync</CardTitle>
        <CardDescription>Background sync runs on the server. The Auto toggle next to the Sync button switches it too.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Label class="cursor-pointer gap-2 font-normal"><Switch v-model="st.s.sync.auto" /> Sync automatically</Label>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Every (minutes)">
            <Input v-model.number="st.s.sync.intervalMinutes" type="number" min="1" max="120" :disabled="!st.s.sync.auto" />
          </Field>
          <Field label="Keep merged PRs for (days)">
            <Input v-model.number="st.s.sync.mergedLookbackDays" type="number" min="1" max="90" />
          </Field>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhGraph :size="20" /> Dependencies</CardTitle>
        <CardDescription>How dependencies you add or remove in PR Deck are stored.</CardDescription>
      </CardHeader>
      <CardContent>
        <Label class="cursor-pointer items-start gap-2 font-normal">
          <Switch v-model="st.s.dependencies.writeToDescription" class="mt-0.5" />
          <span>
            Write them into the PR description on GitHub
            <span class="block text-xs text-muted-foreground">Adds or removes a “Depends on: org/repo#12” line in the dependent PR, so reviewers see it too. Off: kept in PR Deck only.</span>
          </span>
        </Label>
      </CardContent>
    </Card>

    <JiraSettings />
    <SlackSettings />
    <AiSettings />

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhPlug :size="20" /> Use from Claude Code (MCP)</CardTitle>
        <CardDescription>
          Adds tools like <code>overview</code>, <code>list_prs</code>, <code>add_dependency</code>, <code>slack_inbox</code> and <code>create_jira_issue</code>, reading the same local database.
        </CardDescription>
      </CardHeader>
      <CardContent v-if="mcp" class="space-y-1">
        <CodeBlock :code="`claude mcp add prdeck --scope user -- ${mcp.node} ${mcp.tsxCandidates[1]} ${mcp.entry}`" />
        <p class="text-xs text-muted-foreground">Database: {{ mcp.dbPath }}</p>
      </CardContent>
    </Card>

    <ActionBar>
      <template v-if="st.dirty"><span class="size-2 rounded-full bg-warning" />Unsaved changes</template>
      <template v-else><PhCheck class="text-success" />All changes saved</template>
      <template #actions>
        <Button v-if="st.dirty" variant="ghost" size="sm" :disabled="st.busy === 'save'" @click="st.discard">Discard</Button>
        <Button size="sm" :disabled="!st.dirty || st.busy === 'save'" @click="st.save">
          <PhCircleNotch v-if="st.busy === 'save'" class="animate-spin" /> Save settings
        </Button>
      </template>
    </ActionBar>
  </div>
</template>
