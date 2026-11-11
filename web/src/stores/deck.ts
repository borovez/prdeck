import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Overview, PrView, SlackItem } from '@shared/types'
import { toast } from 'vue-sonner'
import { api } from '@/api'

export const useDeck = defineStore('deck', () => {
  const overview = ref<Overview | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const error = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  /** Slack item being turned into a Jira task (opens the modal) */
  const slackToJira = ref<SlackItem | null>(null)

  const prs = computed(() => overview.value?.prs ?? [])
  const byId = computed(() => new Map(prs.value.map((p) => [p.id, p])))
  const selected = computed<PrView | null>(() => (selectedId.value ? byId.value.get(selectedId.value) ?? null : null))
  const jiraByKey = computed(() => new Map((overview.value?.jira ?? []).map((j) => [j.key, j])))
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

  async function sync() {
    if (syncing.value) return
    syncing.value = true
    try {
      overview.value = await api.sync()
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
    timer = window.setInterval(() => !syncing.value && load(), 60_000)
  }

  return { overview, loading, syncing, error, selectedId, slackToJira, prs, byId, selected, jiraByKey, repos, load, sync, mutate, startPolling }
})
