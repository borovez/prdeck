<script lang="ts">
import type { PrView, ReleaseItem } from '@shared/types'

export interface GroupRow {
  id: string
  title: string
  url: string
  pr?: PrView
  via?: ReleaseItem['via']
  /** The row is a release PR itself (drawn as its own group, with a "rolls into" edge) */
  isRelease?: boolean
  /** Shown as a warning icon on the row (e.g. a hotfix not back in dev) */
  warn?: string
}
export interface ReleaseGroupData {
  kind: 'release' | 'unreleased' | 'hotfixes'
  /** Release PR id, "unreleased:<repo>" or "hotfixes:<repo>:<column>" */
  id: string
  repo: string
  /** The release PR (kind release) */
  pr?: PrView
  /** Branch line, e.g. "dev → master" or "dev" */
  branch: string
  rows: GroupRow[]
  jiraKeys: string[]
  expanded: boolean
  toggle: () => void
}

/** Fixed sizes, so the layout can place groups without measuring them */
export const GROUP_W = 320
const HEADER_H = 80
const ROW_H = 28
const FOOTER_H = 30
export const groupHeight = (d: Pick<ReleaseGroupData, 'rows' | 'expanded'>) =>
  HEADER_H + (d.expanded ? d.rows.length * ROW_H : 0) + (d.rows.length ? FOOTER_H : 0) + 2
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { PhCaretDown, PhCaretRight, PhGitMerge, PhGitPullRequest, PhRocketLaunch, PhWarning } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { timeAgo } from '@/utils/format'
import { VIA_LABEL } from '@/utils/releaseFlow'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import RepoName from './RepoName.vue'

/**
 * A release (or a repo's merged-but-unreleased work) on the release graph: header with state and a Jira
 * roll-up, then one row per PR. Every row has its own handles so dependency edges attach to the PR.
 */
const props = defineProps<{ data: ReleaseGroupData }>()
const deck = useDeck()
const drawer = useLayout().view('drawer', { tab: 'details' as string })

/** Jira roll-up: done / in progress / to do / not synced */
const rollup = computed(() => {
  const c = { done: 0, indeterminate: 0, new: 0, unknown: 0 }
  for (const k of props.data.jiraKeys) {
    const cat = deck.jiraByKey.get(k)?.statusCategory
    if (cat === 'done' || cat === 'indeterminate' || cat === 'new') c[cat]++
    else c.unknown++
  }
  return c
})
const total = computed(() => props.data.jiraKeys.length || 1)
const segment = (n: number) => ({ width: `${(n / total.value) * 100}%` })

function openRelease() {
  if (!props.data.pr) return
  drawer.tab = 'contents'
  deck.selectedId = props.data.pr.id
}
function openRow(r: GroupRow, e: MouseEvent) {
  e.stopPropagation()
  if (r.pr && !e.metaKey && !e.ctrlKey) deck.selectedId = r.id
  else window.open(r.url, '_blank', 'noopener')
}
const stateOf = (r: GroupRow) => r.pr?.state ?? 'MERGED'
</script>

<template>
  <div
    :data-pr-id="data.pr?.id"
    :class="cn(
      'rounded-lg border bg-card text-card-foreground shadow-xs',
      data.kind === 'unreleased' && 'border-dashed bg-muted/30',
      data.kind === 'hotfixes' && 'border-l-4 border-l-warning',
      data.pr && deck.selectedId === data.pr.id && 'ring-2 ring-primary',
    )"
    :style="{ width: '320px' }"
  >
    <Handle id="in:group" type="target" :position="Position.Left" :connectable="false" class="rg-handle" style="top: 28px" />
    <Handle id="out:group" type="source" :position="Position.Right" :connectable="false" class="rg-handle" style="top: 28px" />

    <!-- Header: fixed height (see HEADER_H) -->
    <button type="button" class="flex h-[80px] w-full flex-col gap-1 border-b px-3 py-2 text-left" :class="data.pr && 'hover:bg-accent/40'" @click.stop="openRelease">
      <span class="flex w-full min-w-0 items-center gap-1.5 text-xs">
        <template v-if="data.pr">
          <Badge :variant="data.pr.state === 'OPEN' ? 'success' : data.pr.release?.released ? 'muted' : 'merged'" class="h-4 shrink-0 px-1.5 text-[10px]">
            {{ data.pr.state === 'OPEN' ? 'Open' : data.pr.release?.released ? 'Released' : 'Merged' }}
          </Badge>
          <RepoName :id="data.pr.id" class="min-w-0 font-mono font-medium" />
        </template>
        <span v-else class="flex min-w-0 items-center gap-1.5 font-medium">
          {{ data.kind === 'hotfixes' ? 'Hotfixes' : 'Not in a release yet' }}
          <RepoName :repo="data.repo" class="min-w-0 font-mono font-normal text-muted-foreground" />
        </span>
        <span class="flex-1" />
        <Badge variant="count" class="shrink-0">{{ data.rows.length }}</Badge>
      </span>
      <span class="w-full truncate text-[13px] font-medium">{{ data.pr?.title ?? (data.kind === 'hotfixes' ? `Straight to ${data.branch}` : `Merged into ${data.branch}, waiting for a release`) }}</span>
      <span class="flex w-full min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span class="min-w-0 truncate font-mono">{{ data.branch }}</span>
        <span v-if="data.pr?.mergedAt" class="shrink-0">· {{ timeAgo(data.pr.mergedAt) }}</span>
        <span class="flex-1" />
        <span
          v-if="data.jiraKeys.length"
          class="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
          :title="`Jira: ${rollup.done} done, ${rollup.indeterminate} in progress, ${rollup.new} to do${rollup.unknown ? `, ${rollup.unknown} not synced` : ''}`"
        >
          <span class="bg-success" :style="segment(rollup.done)" />
          <span class="bg-info" :style="segment(rollup.indeterminate)" />
          <span class="bg-muted-foreground/40" :style="segment(rollup.new)" />
        </span>
        <span v-if="data.jiraKeys.length" class="shrink-0 tabular-nums">{{ rollup.done }}/{{ data.jiraKeys.length }}</span>
      </span>
    </button>

    <!-- Rows: fixed height each (ROW_H) -->
    <template v-if="data.expanded">
      <div
        v-for="r in data.rows"
        :key="r.id"
        :data-pr-id="r.pr ? r.id : undefined"
        class="relative flex h-7 cursor-pointer items-center gap-1.5 px-3 text-xs hover:bg-accent/50"
        :class="r.pr && deck.selectedId === r.id && 'bg-primary/10'"
        :title="`${r.id}: ${r.title}${r.via && r.via !== 'commit' ? ` (${VIA_LABEL[r.via]})` : ''}${r.warn ? ` · ${r.warn}` : ''}`"
        @click="openRow(r, $event)"
      >
        <Handle :id="`in:${r.id}`" type="target" :position="Position.Left" :connectable="false" class="rg-handle" />
        <Handle :id="`out:${r.id}`" type="source" :position="Position.Right" :connectable="false" class="rg-handle" />
        <PhRocketLaunch v-if="r.isRelease" :size="13" class="text-merged" />
        <PhGitPullRequest v-else-if="stateOf(r) === 'OPEN'" :size="13" class="text-success" />
        <PhGitMerge v-else :size="13" class="text-merged" />
        <span class="shrink-0 font-mono text-muted-foreground">#{{ r.id.split('#')[1] }}</span>
        <span class="min-w-0 flex-1 truncate">{{ r.title }}</span>
        <PhWarning v-if="r.warn" :size="13" weight="fill" class="shrink-0 text-warning" />
        <Badge v-if="r.via && r.via !== 'commit'" variant="muted" class="h-4 shrink-0 px-1 text-[10px]">{{ r.via }}</Badge>
      </div>
    </template>
    <button
      v-if="data.rows.length"
      type="button"
      class="flex h-[30px] w-full items-center gap-1 px-3 text-xs text-muted-foreground hover:text-foreground"
      @click.stop="data.toggle()"
    >
      <PhCaretDown v-if="data.expanded" :size="12" /><PhCaretRight v-else :size="12" />
      {{ data.expanded ? 'Hide PRs' : `Show ${data.rows.length} PRs` }}
    </button>
  </div>
</template>
