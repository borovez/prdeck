<script setup lang="ts">
import { computed, reactive } from 'vue'
import { PhArrowElbowDownRight, PhArrowSquareOut, PhCaretDown, PhCaretRight, PhGitMerge } from '@phosphor-icons/vue'
import type { ReleaseContents } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { VIA_LABEL } from '@/utils/releaseFlow'
import { Badge } from '@/components/ui/badge'
import PrRow from './PrRow.vue'
import RepoName from './RepoName.vue'
import JiraPill from './JiraPill.vue'
import FlagChip from './FlagChip.vue'

/**
 * PRs and Jira issues a release ships. Synced PRs render as rows (they open the PR panel); others link to GitHub.
 * An item that is itself a release PR expands in place, one level deeper (arrows show the level).
 */
const props = withDefaults(defineProps<{ contents: ReleaseContents; depth?: number; seen?: string[] }>(), { depth: 0, seen: () => [] })
const deck = useDeck()
const open = reactive<Record<string, boolean>>({})
const path = computed(() => [...props.seen, props.contents.prId])
const rows = computed(() =>
  props.contents.items.map((i) => {
    const nested = deck.releaseById.get(i.id)
    // A release that contains one of its parents would loop; show it as a plain row
    return { item: i, pr: deck.byId.get(i.id), nested: nested && !path.value.includes(i.id) ? nested : undefined }
  }),
)
/** Flags named by the release PR and the synced PRs it ships */
const flags = computed(() => {
  const own = deck.byId.get(props.contents.prId)?.flags ?? []
  return [...new Set([...own, ...props.contents.items.flatMap((i) => deck.byId.get(i.id)?.flags ?? [])])]
})
const indent = computed(() => ({ paddingLeft: `${props.depth * 20}px` }))
</script>

<template>
  <div :class="depth ? '' : 'space-y-3'">
    <div v-if="!depth && contents.jiraKeys.length" class="flex flex-wrap items-center gap-1.5 px-2.5 pt-1">
      <span class="text-xs text-muted-foreground">Jira</span>
      <JiraPill v-for="k in contents.jiraKeys" :key="k" :issue-key="k" />
    </div>
    <div v-if="!depth && flags.length" class="flex flex-wrap items-center gap-1.5 px-2.5">
      <span class="text-xs text-muted-foreground">Flags</span>
      <FlagChip v-for="k in flags" :key="k" :flag-key="k" />
    </div>
    <div class="divide-y" :class="{ 'border-t': depth > 0 }">
      <div v-for="{ item, pr, nested } in rows" :key="item.id">
        <div class="flex min-w-0 items-center py-1" :style="indent">
          <PhArrowElbowDownRight :size="14" class="ml-2.5 text-muted-foreground/70" />
          <button
            v-if="nested"
            type="button"
            class="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            :aria-expanded="!!open[item.id]"
            :title="open[item.id] ? 'Hide what this release ships' : `Show what this release ships (${nested.items.length})`"
            @click="open[item.id] = !open[item.id]"
          >
            <PhCaretDown v-if="open[item.id]" :size="12" /><PhCaretRight v-else :size="12" />
          </button>
          <PrRow v-if="pr" :pr="pr" compact class="min-w-0 flex-1">
            <template v-if="nested" #badges>
              <Badge variant="merged" title="This PR is a release itself">release · {{ nested.items.length }}</Badge>
            </template>
          </PrRow>
          <a v-else :href="item.url" target="_blank" rel="noopener" class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent/50">
            <PhGitMerge :size="14" class="text-merged" />
            <RepoName :id="item.id" class="max-w-[40%] font-mono text-xs" />
            <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ item.author }}<template v-if="item.mergedAt"> · {{ timeAgo(item.mergedAt) }}</template></span>
            <Badge v-if="item.via !== 'commit'" variant="muted" class="shrink-0" :title="VIA_LABEL[item.via]">{{ item.via }}</Badge>
            <Badge v-if="nested" variant="merged" class="shrink-0" title="This PR is a release itself">release · {{ nested.items.length }}</Badge>
            <PhArrowSquareOut :size="13" class="text-muted-foreground" />
          </a>
        </div>
        <ReleaseItems v-if="nested && open[item.id]" :contents="nested" :depth="depth + 1" :seen="path" />
      </div>
    </div>
    <p v-if="!depth && !contents.items.length" class="px-2.5 py-3 text-sm text-muted-foreground">
      {{ contents.error ? `Couldn't read the release: ${contents.error}` : 'No pull requests found in this release.' }}
    </p>
    <p v-if="!depth && contents.truncated" class="px-2.5 text-xs text-muted-foreground">Only the first {{ contents.commitsScanned }} commits were scanned.</p>
  </div>
</template>
