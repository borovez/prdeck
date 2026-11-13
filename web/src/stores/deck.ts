import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { JiraFieldValue, Overview, PrView, SyncState } from '@shared/types'

/** What the Jira composer opens on */
export type ComposerTarget =
  | {
      mode: 'create'
      projectKey?: string
      summary?: string
      description?: string
      values?: Record<string, JiraFieldValue>
      /** Context for Claude: a PR, a Slack message (also marked done on create) */
      prId?: string
      slackItemId?: string
    }
  | { mode: 'edit'; key: string }
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { clearTransitions } from '@/composables/jiraTransitions'

export const useDeck = defineStore('deck', () => {
  const overview = ref<Overview | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const error = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  /** Slack item shown in the side panel; only one side panel is open at a time */
  const selectedSlackId = ref<string | null>(null)
  /** Jira issue shown in the side panel */
  const selectedJiraKey = ref<string | null>(null)
  // One side panel at a time: opening one closes the others
  const panels = [selectedId, selectedSlackId, selectedJiraKey]
  for (const p of panels) watch(p, (v) => v && panels.forEach((o) => o !== p && (o.value = null)))
  /** Jira issue composer: a new issue (optionally pre-filled) or an existing one to edit */
  const composer = ref<ComposerTarget | null>(null)
  /** PR whose title and description are open in the PR writer */
  const prWriter = ref<string | null>(null)
  /** Jira issue whose AI-agent prompt is open */
  const agentPromptKey = ref<string | null>(null)

  const prs = computed(() => overview.value?.prs ?? [])
  const byId = computed(() => new Map(prs.value.map((p) => [p.id, p])))
  /** What each release PR ships, by release PR id */
  const releaseById = computed(() => new Map((overview.value?.releases ?? []).map((r) => [r.prId, r])))
  const selectedSlack = computed(() => (overview.value?.slack ?? []).find((i) => i.id === selectedSlackId.value) ?? null)
  const selected = computed<PrView | null>(() => (selectedId.value ? byId.value.get(selectedId.value) ?? null : null))
  const jiraByKey = computed(() => new Map((overview.value?.jira ?? []).map((j) => [j.key, j])))
  /** LaunchDarkly flags by key */
  const flagByKey = computed(() => new Map((overview.value?.flags ?? []).map((f) => [f.key, f])))
  const repos = computed(() => [...new Set(prs.value.map((p) => p.repo))].sort())

  async function load() {
    loading.value = true
    try {
      overview.value = await api.overview()
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** Live sync progress (steps), polled while a sync runs: mine, the background one or the MCP's */
  const syncStatus = ref<SyncState | null>(null)
  const syncRunning = computed(() => syncing.value || !!syncStatus.value?.running)
  let statusTimer: number | undefined
  function watchSync() {
    if (statusTimer) return
    const tick = async () => {
      try {
        syncStatus.value = await api.syncStatus()
      } catch {
        /* keep the last state */
      }
      if (syncing.value || syncStatus.value?.running) statusTimer = window.setTimeout(tick, 700)
      else {
        statusTimer = undefined
        load() // a background sync finished: show its results
      }
    }
    statusTimer = window.setTimeout(tick, 300)
  }
  // A sync someone else started (auto-sync, MCP) shows up in the overview: follow it
  watch(
    () => overview.value?.sync,
    (s) => {
      if (!s) return
      if (!syncStatus.value?.running) syncStatus.value = s
      if (s.running && !syncing.value) watchSync()
    },
  )

  async function sync() {
    if (syncRunning.value) return
    syncing.value = true
    watchSync()
    try {
      overview.value = await api.sync()
      syncStatus.value = overview.value.sync
      clearTransitions() // workflows may have changed; refetch on next open
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      syncing.value = false
    }
  }

  /**
   * Run a write, then reload (mutations change derived state: blocked, actions, chains).
   * Errors become a toast; `success` (if given) too. Resolves to whether the write worked.
   */
  async function mutate(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
    if (success) toast.success(success)
    await load()
    return true
  }

  let timer: number | undefined
  function startPolling() {
    clearInterval(timer)
    timer = window.setInterval(() => !syncRunning.value && load(), 60_000)
  }

  return { overview, loading, syncing, syncStatus, syncRunning, error, selectedId, selectedSlackId, selectedSlack, selectedJiraKey, composer, prWriter, agentPromptKey, prs, byId,
    releaseById, selected, jiraByKey, flagByKey, repos, load, sync, mutate, startPolling }
})
