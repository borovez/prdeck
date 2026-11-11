<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCircleNotch, PhGithubLogo, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue'
import type { GithubAccount } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useSettings } from '@/stores/settings'
import { clone, splitList } from '@/utils/format'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import Field from '@/components/Field.vue'
import FormDialog from '@/components/FormDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'

const st = useSettings()
const deck = useDeck()
const s = computed(() => st.s!)
const accounts = computed(() => s.value.github.accounts)

// ---- Accounts: each one is saved on its own from its dialog
const dialogOpen = ref(false)
const draft = ref<GithubAccount | null>(null)
function openAccount(a?: GithubAccount) {
  draft.value = a ? clone(a) : { id: '', label: 'GitHub token', token: '', login: null, orgs: [], source: 'pat' }
  dialogOpen.value = true
}
const saveAccounts = (list: GithubAccount[], message: string) => st.saveSection({ github: { accounts: list } }, message)

const check = () => api.testGithub(draft.value!.token, draft.value!.id || undefined)
const testDraft = () =>
  st.run('', async () => {
    const r = await check()
    return `Token OK: ${r.login} · orgs: ${r.orgs.join(', ') || 'none'}`
  })
async function submitAccount() {
  const d = draft.value!
  // A new or changed token is checked first (errors toast); a label/orgs edit saves directly
  if ((d.token || !d.id) && !(await st.run('', async () => void (await check())))) return false
  const list = d.id ? accounts.value.map((a) => (a.id === d.id ? d : a)) : [...accounts.value, d]
  return saveAccounts(list, d.id ? 'Account saved' : 'Account added')
}
const removeAccount = (a: GithubAccount) => saveAccounts(accounts.value.filter((x) => x.id !== a.id), `Removed ${a.label}`)

const importGh = () =>
  st.run('gh', async () => {
    const r = await api.importGhCli()
    st.apply(r.settings, ['github'])
    await deck.load()
    return `Connected as ${r.login} via gh CLI. Press Sync to load your PRs.`
  })

// ---- Tracked repos and release refs: part of the page form (saved from the action bar)
const owners = ref<string[]>([])
const pickOwner = ref('')
const repoOptions = ref<string[]>([])
const firstAccount = () => accounts.value.find((a) => a.id)!
const loadOwners = () => st.run('owners', async () => void (owners.value = await api.owners(firstAccount().id)))
const loadRepos = () =>
  st.run('repos', async () => void (repoOptions.value = (await api.repos(firstAccount().id, pickOwner.value)).map((r) => r.nameWithOwner.toLowerCase())))
function toggleRepo(r: string) {
  const t = s.value.trackedRepos
  const i = t.indexOf(r)
  if (i >= 0) t.splice(i, 1)
  else t.push(r)
}
const newRepo = ref('')
const newOverrideRepo = ref('')
const newOverrideRef = ref('')
function addOverride() {
  if (!newOverrideRepo.value) return
  s.value.releaseRefs[newOverrideRepo.value.toLowerCase()] = newOverrideRef.value || 'master'
  newOverrideRepo.value = newOverrideRef.value = ''
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><PhGithubLogo :size="20" /> GitHub</CardTitle>
      <CardDescription>One token usually sees every org you belong to (authorise SSO per org). Add more accounts if some orgs need a different login.</CardDescription>
      <CardAction class="flex gap-2">
        <Button size="sm" :disabled="st.busy === 'gh'" @click="importGh">
          <PhCircleNotch v-if="st.busy === 'gh'" class="animate-spin" /> Use my gh CLI login
        </Button>
        <Button size="sm" variant="outline" @click="openAccount()"><PhPlus /> Add token</Button>
      </CardAction>
    </CardHeader>
    <CardContent class="space-y-4">
      <div v-if="accounts.length" class="divide-y rounded-lg border">
        <div v-for="a in accounts" :key="a.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span class="font-medium">{{ a.label }}</span>
          <Badge variant="muted">{{ a.source }}</Badge>
          <Badge v-if="a.login" variant="success">{{ a.login }}</Badge>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ a.orgs.length ? `Limited to ${a.orgs.join(', ')}` : 'All orgs this token can see' }}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Edit account" @click="openAccount(a)"><PhPencilSimple /></Button>
          <ConfirmDialog
            :title="`Remove ${a.label}?`"
            description="Its stored token is deleted. PRs only this account could see drop out on the next sync."
            confirm-label="Remove"
            @confirm="removeAccount(a)"
          >
            <Button variant="ghost" size="icon-sm" class="text-destructive hover:text-destructive" aria-label="Remove account"><PhTrash /></Button>
          </ConfirmDialog>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">No accounts yet. Use your gh CLI login or add a token.</p>

      <Separator />
      <div>
        <h3 class="font-medium">Tracked repos (team view)</h3>
        <p class="text-sm text-muted-foreground">Every open PR in these repos is pulled in, not just yours, so you see team work and dependencies.</p>
      </div>
      <div class="flex flex-wrap gap-1">
        <Badge v-for="r in s.trackedRepos" :key="r" variant="outline" class="gap-1 pr-1">
          {{ r }}<button class="rounded px-1 text-muted-foreground hover:text-foreground" :aria-label="`Stop tracking ${r}`" @click="toggleRepo(r)">×</button>
        </Badge>
        <span v-if="!s.trackedRepos.length" class="text-sm text-muted-foreground">None yet.</span>
      </div>
      <div v-if="accounts.some((a) => a.id && a.hasToken)" class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" :disabled="st.busy === 'owners'" @click="loadOwners">Browse orgs</Button>
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
          When a merge counts as released. Repos that release through PRs (dev → master/main) use that branch; other repos use their latest GitHub
          release/tag. Set a branch per repo (e.g. <code>master</code>) to override.
        </p>
      </div>
      <div class="space-y-1.5">
        <div v-for="repo in Object.keys(s.releaseRefs)" :key="repo" class="flex items-center gap-2 text-sm">
          <span class="w-72 truncate font-mono">{{ repo }}</span>
          <Input v-model="s.releaseRefs[repo]" class="h-8 w-40" />
          <Button variant="ghost" size="icon-xs" :aria-label="`Remove override for ${repo}`" @click="delete s.releaseRefs[repo]"><PhTrash /></Button>
        </div>
        <form class="flex gap-2" @submit.prevent="addOverride">
          <Input v-model="newOverrideRepo" class="h-8 w-72" placeholder="owner/name" list="all-repos" />
          <datalist id="all-repos"><option v-for="r in deck.repos" :key="r" :value="r" /></datalist>
          <Input v-model="newOverrideRef" class="h-8 w-40" placeholder="master" />
          <Button size="sm" variant="outline" type="submit">Add override</Button>
        </form>
      </div>
    </CardContent>

    <FormDialog
      v-model:open="dialogOpen"
      :title="draft?.id ? `Edit ${draft.label}` : 'Add GitHub token'"
      description="Classic or fine-grained token with repo and read:org access."
      :submit-label="draft?.id ? 'Save' : 'Add account'"
      :on-test="draft?.source === 'pat' ? testDraft : undefined"
      :on-submit="submitAccount"
    >
      <template v-if="draft">
        <Field label="Label"><Input v-model="draft.label" required /></Field>
        <Field v-if="draft.source === 'pat'" label="Token">
          <Input
            v-model="draft.token"
            type="password"
            class="font-mono"
            :required="!draft.hasToken"
            :placeholder="draft.hasToken ? '•••••••• stored (leave blank to keep)' : 'ghp_… or github_pat_…'"
          />
        </Field>
        <Field label="Limit to orgs" hint="Comma separated. Empty = every org this token can see.">
          <Input :model-value="draft.orgs.join(', ')" @change="draft.orgs = splitList(($event.target as HTMLInputElement).value)" />
        </Field>
      </template>
    </FormDialog>
  </Card>
</template>
