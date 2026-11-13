import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { UpdateStatus } from '@shared/types'
import { api } from '@/api'
import { useLayout } from '@/stores/layout'

/** Release check shared by the header pill and the user menu */
const status = ref<UpdateStatus | null>(null)
const checking = ref(false)
const installing = ref(false)
/** The header's update popover, opened from the toast's "What's new" */
const popoverOpen = ref(false)
let timer: number | undefined

/** One toast per new version: "PR Deck X is available", with the action that fits this install */
function announce(s: UpdateStatus) {
  const seen = useLayout().view('updates', { announced: '' })
  if (!s.available || !s.latest || seen.announced === s.latest) return
  seen.announced = s.latest
  const action = s.canSelfUpdate
    ? { label: 'Update', onClick: () => install() }
    : s.downloadUrl
      ? { label: 'Download', onClick: () => window.open(s.downloadUrl!, '_blank', 'noopener') }
      : { label: 'View release', onClick: () => window.open(s.url, '_blank', 'noopener') }
  toast.info(`PR Deck ${s.latest} is available`, {
    description: `You have ${s.current}.`,
    duration: 15_000,
    action,
    cancel: { label: 'What’s new', onClick: () => (popoverOpen.value = true) },
  })
}

async function load(refresh = false) {
  checking.value = true
  try {
    status.value = await api.updateStatus(refresh)
    announce(status.value)
    if (refresh && !status.value.available)
      toast.success(status.value.error ? 'Couldn’t check for updates' : `PR Deck ${status.value.current} is the latest`, { description: status.value.error ?? undefined })
  } catch {
    /* offline: try again later */
  } finally {
    checking.value = false
  }
}

/** Starts the update, then waits for the restarted server to report the new version and reloads */
async function install() {
  const target = status.value?.latest
  if (!target || installing.value) return
  installing.value = true
  try {
    await api.startUpdate()
  } catch (e) {
    installing.value = false
    return toast.error((e as Error).message)
  }
  const started = Date.now()
  const poll = async () => {
    const h = await api.health().catch(() => null)
    // Same server still up: did the update script fail?
    if (h && h.version === status.value?.current) {
      const s = await api.updateStatus().catch(() => null)
      if (s?.failed && !s.updating) {
        status.value = s
        installing.value = false
        toast.error('The update failed', { description: `${s.failed.message.split('\n').slice(-2).join(' ')} (log: ${s.log})`, duration: 20_000 })
        return
      }
    }
    if (h && h.version !== status.value?.current) {
      toast.success(`Updated to ${h.version}`, { description: 'Reloading…' })
      setTimeout(() => location.reload(), 800)
      return
    }
    if (Date.now() - started > 8 * 60_000) {
      installing.value = false
      toast.error('The update is taking long', { description: `See ${status.value?.log}` })
      return
    }
    setTimeout(poll, 2500)
  }
  setTimeout(poll, 4000)
}

export function useUpdates() {
  if (!timer) {
    load()
    timer = window.setInterval(() => load(), 30 * 60_000)
  }
  return { status, checking, installing, popoverOpen, load, install }
}
