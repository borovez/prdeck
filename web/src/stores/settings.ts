import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { Settings } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

type Section = keyof Settings

/**
 * Settings page state. The page edits `s` and saves it all from the ActionBar; connection dialogs
 * save just their own section with `saveSection`, leaving other unsaved edits on the page alone.
 */
export const useSettings = defineStore('settings', () => {
  const deck = useDeck()
  const s = ref<Settings | null>(null)
  /** Last saved settings (JSON), to show unsaved changes and allow discarding them */
  const saved = ref('')
  const dirty = computed(() => !!s.value && JSON.stringify(s.value) !== saved.value)
  const busy = ref('')

  function set(next: Settings) {
    s.value = structuredClone(next)
    saved.value = JSON.stringify(next)
  }
  /** Take these sections from a fresh server copy into both the page and the saved snapshot */
  function apply(fresh: Settings, sections: Section[]) {
    if (!s.value) return set(fresh)
    const snapshot = JSON.parse(saved.value) as Settings
    for (const k of sections) {
      ;(snapshot as unknown as Record<Section, unknown>)[k] = structuredClone(fresh[k])
      ;(s.value as unknown as Record<Section, unknown>)[k] = structuredClone(fresh[k])
    }
    saved.value = JSON.stringify(snapshot)
  }

  const load = async () => set(await api.settings())
  const discard = () => set(JSON.parse(saved.value))

  /** Run an action with a busy label; its message (if any) becomes a success toast, errors an error toast. */
  async function run(label: string, fn: () => Promise<string | void>): Promise<boolean> {
    busy.value = label
    try {
      const msg = await fn()
      if (msg) toast.success(msg)
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      busy.value = ''
    }
  }

  const save = () =>
    run('save', async () => {
      set(await api.saveSettings(s.value!))
      await deck.load()
      return 'Settings saved.'
    })

  /** Save only `patch`'s sections, on top of the last saved settings. */
  const saveSection = (patch: Partial<Settings>, message: string) =>
    run('section', async () => {
      const fresh = await api.saveSettings({ ...(JSON.parse(saved.value) as Settings), ...patch })
      apply(fresh, Object.keys(patch) as Section[])
      await deck.load()
      return message
    })

  // The header Auto toggle writes sync.auto directly; mirror it without marking the page dirty
  watch(
    () => deck.overview?.autoSync.enabled,
    (enabled) => {
      if (!s.value || enabled === undefined || enabled === s.value.sync.auto) return
      const snapshot = JSON.parse(saved.value) as Settings
      snapshot.sync.auto = s.value.sync.auto = enabled
      saved.value = JSON.stringify(snapshot)
    },
  )

  return { s, dirty, busy, load, discard, run, save, saveSection, apply }
})
