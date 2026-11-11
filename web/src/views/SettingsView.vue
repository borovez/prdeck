<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  PhCircleNotch,
  PhGithubLogo,
  PhKanban,
  PhPlug,
  PhPlus,
  PhSlackLogo,
  PhSparkle,
  PhTrash,
} from '@phosphor-icons/vue'
import type { GithubAccount, Settings } from '@shared/types'
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

const deck = useDeck()
const s = ref<Settings | null>(null)
const busy = ref('')
const mcp = ref<Awaited<ReturnType<typeof api.mcpInfo>> | null>(null)

onMounted(async () => {
  s.value = await api.settings()
  mcp.value = await api.mcpInfo().catch(() => null)
})

async function run(label: string, fn: () => Promise<string>) {
  busy.value = label
  try {
    toast.success(await fn())
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    busy.value = ''
  }
}

const save = () =>
  run('save', async () => {
    s.value = await api.saveSettings(s.value!)
    await deck.load()
    return 'Settings saved.'
  })

// ---- GitHub
const importGh = () =>
  run('gh', async () => {
    const r = await api.importGhCli()
    s.value = r.settings
    await deck.load()
    return `Connected as ${r.login} via gh CLI (orgs: ${r.orgs.join(', ') || 'none'}). Press Sync to load your PRs.`
  })
const addAccount = () =>
  s.value!.github.accounts.push({ id: '', label: 'GitHub token', token: '', login: null, orgs: [], source: 'pat' } as GithubAccount)
const testAccount = (a: GithubAccount) =>
  run('test-' + a.id, async () => {
    const r = await api.testGithub(a.token, a.id || undefined)
    return `Token OK: ${r.login} · orgs: ${r.orgs.join(', ') || 'none'}`
  })

const owners = ref<string[]>([])
const pickOwner = ref('')
const repoOptions = ref<string[]>([])
const firstAccount = () => s.value!.github.accounts.find((a) => a.id)!
const loadOwners = () => run('owners', async () => ((owners.value = await api.owners(firstAccount().id)), `Found ${owners.value.length} orgs/users.`))
const loadRepos = () =>
  run('repos', async () => {
    repoOptions.value = (await api.repos(firstAccount().id, pickOwner.value)).map((r) => r.nameWithOwner.toLowerCase())
    return `${repoOptions.value.length} repos in ${pickOwner.value}`
  })
function toggleRepo(r: string) {
  const t = s.value!.trackedRepos
  const i = t.indexOf(r)
  if (i >= 0) t.splice(i, 1)
  else t.push(r)
}
const newRepo = ref('')
const newOverrideRepo = ref('')
const newOverrideRef = ref('')
function addOverride() {
  if (!newOverrideRepo.value) return
  s.value!.releaseRefs[newOverrideRepo.value.toLowerCase()] = newOverrideRef.value || 'master'
  newOverrideRepo.value = newOverrideRef.value = ''
}

// ---- Jira
function enableJira() {
  s.value!.jira = {
    baseUrl: 'https://your-site.atlassian.net',
    email: '',
    apiToken: '',
    projectKeys: [],
    myJql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
    create: { projectKey: '', issueType: 'Task', extraFieldsJson: '', assignToMe: true },
  }
}
const testJira = () =>
  run('jira', async () => {
    const j = s.value!.jira!
    return `Jira OK: ${(await api.testJira(j.baseUrl, j.email, j.apiToken)).displayName}`
  })

// ---- Slack
const enableSlack = () =>
  (s.value!.slack = {
    token: '',
    userId: null,
    teamUrl: null,
    lookbackDays: 7,
    maxConversations: 40,
    includeSaved: true,
    todoReactions: ['todo', 'eyes', 'bookmark'],
  })
const testSlack = () =>
  run('slack', async () => {
    const r = await api.testSlack(s.value!.slack!.token)
    return `Slack OK: ${r.user} @ ${r.team}`
  })

const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
const SLACK_SCOPES =
  'search:read, im:history, mpim:history, im:read, mpim:read, channels:history, groups:history, users:read, stars:read, reactions:read, chat:write'
</script>

<template>
  <div v-if="s" class="mx-auto max-w-4xl space-y-6 pb-24">

    <!-- GitHub -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhGithubLogo :size="20" /> GitHub</CardTitle>
        <CardDescription>One token usually sees every org you belong to (authorise SSO per org). Add more accounts if some orgs need a different login.</CardDescription>
        <CardAction class="flex gap-2">
          <Button size="sm" :disabled="busy === 'gh'" @click="importGh">
            <PhCircleNotch v-if="busy === 'gh'" class="animate-spin" /> Use my gh CLI login
          </Button>
          <Button size="sm" variant="outline" @click="addAccount"><PhPlus /> Add token</Button>
        </CardAction>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-for="(a, i) in s.github.accounts" :key="a.id || i" class="space-y-2 rounded-lg border p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Input v-model="a.label" class="h-8 w-48" placeholder="Label" />
            <Badge variant="muted">{{ a.source }}</Badge>
            <Badge v-if="a.login" variant="success">{{ a.login }}</Badge>
            <span class="flex-1" />
            <Button variant="ghost" size="sm" :disabled="!a.token && !a.hasToken" @click="testAccount(a)">Test</Button>
            <Button variant="ghost" size="icon-sm" class="text-destructive" @click="s.github.accounts.splice(i, 1)"><PhTrash /></Button>
          </div>
          <Input
            v-if="a.source === 'pat'"
            v-model="a.token"
            type="password"
            class="font-mono"
            :placeholder="a.hasToken ? '•••••••• stored (leave blank to keep)' : 'ghp_… or github_pat_… (scopes: repo, read:org)'"
          />
          <Label class="gap-2 font-normal">
            <span class="shrink-0 text-muted-foreground">Limit to orgs</span>
            <Input :model-value="a.orgs.join(', ')" class="h-8" placeholder="empty = every org this token can see" @change="a.orgs = list(($event.target as HTMLInputElement).value)" />
          </Label>
        </div>

        <Separator />
        <div>
          <h3 class="font-medium">Tracked repos (team view)</h3>
          <p class="text-sm text-muted-foreground">Every open PR in these repos is pulled in, not just yours, so you see team work and dependencies.</p>
        </div>
        <div class="flex flex-wrap gap-1">
          <Badge v-for="r in s.trackedRepos" :key="r" variant="outline" class="gap-1 pr-1">
            {{ r }}<button class="rounded px-1 text-muted-foreground hover:text-foreground" @click="toggleRepo(r)">×</button>
          </Badge>
          <span v-if="!s.trackedRepos.length" class="text-sm text-muted-foreground">None yet.</span>
        </div>
        <div v-if="s.github.accounts.some((a) => a.id && (a.hasToken || a.token))" class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" @click="loadOwners">Browse orgs</Button>
          <NativeSelect v-if="owners.length" v-model="pickOwner" size="sm" @change="loadRepos">
            <NativeSelectOption value="" disabled>Pick an org…</NativeSelectOption>
            <NativeSelectOption v-for="o in owners" :key="o" :value="o">{{ o }}</NativeSelectOption>
          </NativeSelect>
          <form class="flex gap-1" @submit.prevent="newRepo && (toggleRepo(newRepo.toLowerCase()), (newRepo = ''))">
            <Input v-model="newRepo" class="h-8 w-56" placeholder="or type owner/name" />
            <Button size="sm" variant="outline" type="submit">Add</Button>
          </form>
        </div>
        <div v-if="repoOptions.length" class="grid max-h-60 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm">
          <Label v-for="r in repoOptions" :key="r" class="cursor-pointer gap-2 font-normal">
            <Checkbox :model-value="s.trackedRepos.includes(r)" @update:model-value="toggleRepo(r)" /> {{ r }}
          </Label>
        </div>

        <Separator />
        <div>
          <h3 class="font-medium">Releases</h3>
          <p class="text-sm text-muted-foreground">
            A “needs release” dependency is satisfied once the prerequisite's merge commit is in the repo's latest GitHub release/tag — or, with a branch set per repo
            (e.g. <code>master</code>), once it's merged into that branch.
          </p>
        </div>
        <div class="space-y-1.5">
          <div v-for="repo in Object.keys(s.releaseRefs)" :key="repo" class="flex items-center gap-2 text-sm">
            <span class="w-72 truncate font-mono">{{ repo }}</span>
            <Input v-model="s.releaseRefs[repo]" class="h-8 w-40" />
            <Button variant="ghost" size="icon-xs" @click="delete s.releaseRefs[repo]"><PhTrash /></Button>
          </div>
          <form class="flex gap-2" @submit.prevent="addOverride">
            <Input v-model="newOverrideRepo" class="h-8 w-72" placeholder="owner/name" list="all-repos" />
            <datalist id="all-repos"><option v-for="r in deck.repos" :key="r" :value="r" /></datalist>
            <Input v-model="newOverrideRef" class="h-8 w-40" placeholder="master" />
            <Button size="sm" variant="outline" type="submit">Add override</Button>
          </form>
        </div>
      </CardContent>
    </Card>

    <!-- Jira -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhKanban :size="20" /> Jira</CardTitle>
        <CardDescription>
          Create an API token at <a class="text-primary hover:underline" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank">id.atlassian.com → API tokens</a>.
        </CardDescription>
        <CardAction v-if="!s.jira"><Button size="sm" @click="enableJira">Connect Jira</Button></CardAction>
      </CardHeader>
      <CardContent v-if="s.jira" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5"><Label>Site URL</Label><Input v-model="s.jira.baseUrl" /></div>
          <div class="grid gap-1.5"><Label>Email</Label><Input v-model="s.jira.email" /></div>
          <div class="col-span-2 grid gap-1.5">
            <Label>API token</Label>
            <Input v-model="s.jira.apiToken" type="password" class="font-mono" :placeholder="s.jira.hasToken ? '•••••••• stored (leave blank to keep)' : 'API token'" />
          </div>
          <div class="grid gap-1.5">
            <Label>Project keys to detect in PRs</Label>
            <Input :model-value="s.jira.projectKeys.join(', ')" placeholder="PROJ, OPS (empty = any)" @change="s.jira.projectKeys = list(($event.target as HTMLInputElement).value).map((k) => k.toUpperCase())" />
          </div>
          <div class="grid gap-1.5"><Label>“My tasks” JQL</Label><Input v-model="s.jira.myJql" class="font-mono text-xs" /></div>
        </div>
        <Separator />
        <h3 class="font-medium">Issues created from Slack</h3>
        <div class="grid grid-cols-3 items-end gap-3">
          <div class="grid gap-1.5"><Label>Default project</Label><Input v-model="s.jira.create.projectKey" class="font-mono" placeholder="PROJ" /></div>
          <div class="grid gap-1.5"><Label>Default type</Label><Input v-model="s.jira.create.issueType" /></div>
          <Label class="h-9 cursor-pointer gap-2 font-normal"><Checkbox v-model="s.jira.create.assignToMe" /> Assign to me</Label>
          <div class="col-span-3 grid gap-1.5">
            <Label>Extra required fields (JSON)</Label>
            <Input v-model="s.jira.create.extraFieldsJson" class="font-mono text-xs" placeholder='{"customfield_12345": {"id": "10001"}}' />
            <p class="text-xs text-muted-foreground">Merged into every create call, e.g. a required custom field.</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" @click="testJira">Test connection</Button>
          <Button size="sm" variant="ghost" class="text-destructive" @click="s.jira = null">Disconnect</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Slack -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhSlackLogo :size="20" /> Slack</CardTitle>
        <CardDescription>Mentions, unanswered DMs and group chats, saved/bookmarked messages, and messages you marked with a todo reaction.</CardDescription>
        <CardAction v-if="!s.slack"><Button size="sm" @click="enableSlack">Connect Slack</Button></CardAction>
      </CardHeader>
      <CardContent v-if="s.slack" class="space-y-4">
        <div class="text-sm text-muted-foreground">
          Create a Slack app at <a class="text-primary hover:underline" href="https://api.slack.com/apps" target="_blank">api.slack.com/apps</a> → OAuth &amp; Permissions →
          add these <b>User Token Scopes</b>, install it to your workspace, and paste the <code>xoxp-…</code> User OAuth Token:
          <code class="mt-1.5 block rounded-md bg-muted p-2 text-xs text-foreground">{{ SLACK_SCOPES }}</code>
        </div>
        <Input v-model="s.slack.token" type="password" class="font-mono" :placeholder="s.slack.hasToken ? '•••••••• stored (leave blank to keep)' : 'xoxp-…'" />
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5"><Label>Look back (days)</Label><Input v-model.number="s.slack.lookbackDays" type="number" min="1" max="60" /></div>
          <div class="grid gap-1.5"><Label>Max DMs / groups scanned</Label><Input v-model.number="s.slack.maxConversations" type="number" min="5" max="200" /></div>
          <Label class="cursor-pointer gap-2 font-normal"><Switch v-model="s.slack.includeSaved" /> Include saved / bookmarked messages</Label>
          <div class="grid gap-1.5">
            <Label>Todo reactions</Label>
            <Input :model-value="s.slack.todoReactions.join(', ')" placeholder="todo, eyes, bookmark" @change="s.slack.todoReactions = list(($event.target as HTMLInputElement).value).map((r) => r.replace(/:/g, ''))" />
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="outline" @click="testSlack">Test connection</Button>
          <Button size="sm" variant="ghost" class="text-destructive" @click="s.slack = null">Disconnect</Button>
          <Badge v-if="s.slack.userId" variant="success">{{ s.slack.userId }}</Badge>
        </div>
      </CardContent>
    </Card>

    <!-- Claude -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhSparkle :size="20" /> Claude (drafting Jira tasks)</CardTitle>
        <CardDescription>Leave the key blank to use <code>ANTHROPIC_API_KEY</code> or your <code>ant auth login</code> profile from the server's environment.</CardDescription>
      </CardHeader>
      <CardContent class="grid grid-cols-2 gap-3">
        <Input v-model="s.ai.apiKey" type="password" class="font-mono" :placeholder="s.ai.hasKey ? '•••••••• stored' : 'sk-ant-… (optional)'" />
        <NativeSelect v-model="s.ai.model" class="w-full">
          <NativeSelectOption value="claude-opus-5-5">Claude Opus 5.5 (default)</NativeSelectOption>
          <NativeSelectOption value="claude-sonnet-5-5">Claude Sonnet 5.5</NativeSelectOption>
          <NativeSelectOption value="claude-haiku-5-5">Claude Haiku 5.5</NativeSelectOption>
        </NativeSelect>
      </CardContent>
    </Card>

    <!-- MCP -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><PhPlug :size="20" /> Use from Claude Code (MCP)</CardTitle>
        <CardDescription>
          Adds tools like <code>overview</code>, <code>list_prs</code>, <code>add_dependency</code>, <code>slack_inbox</code> and <code>create_jira_issue</code>, reading the same local database.
        </CardDescription>
      </CardHeader>
      <CardContent v-if="mcp" class="space-y-1">
        <pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs">claude mcp add prdeck --scope user -- {{ mcp.node }} {{ mcp.tsxCandidates[1] }} {{ mcp.entry }}</pre>
        <p class="text-xs text-muted-foreground">Database: {{ mcp.dbPath }}</p>
      </CardContent>
    </Card>

    <div class="sticky bottom-4 flex justify-end">
      <Button size="lg" class="shadow-lg" :disabled="busy === 'save'" @click="save">
        <PhCircleNotch v-if="busy === 'save'" class="animate-spin" /> Save settings
      </Button>
    </div>
  </div>
</template>
