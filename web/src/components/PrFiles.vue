<script setup lang="ts">
import { ref } from 'vue'
import { PhArrowSquareOut, PhCaretDown, PhCaretRight } from '@phosphor-icons/vue'
import type { PrFile } from '@shared/types'
import { cn } from '@/lib/utils'

/** Changed files with their diffs. The first few are open; large diffs were cut on the server. */
const props = defineProps<{ files: PrFile[]; truncated: boolean; prUrl: string }>()
const open = ref(new Set(props.files.slice(0, 5).map((f) => f.filename)))
const toggle = (f: string) => (open.value.has(f) ? open.value.delete(f) : open.value.add(f))

const STATUS: Record<string, { label: string; cls: string }> = {
  added: { label: 'A', cls: 'text-success' },
  removed: { label: 'D', cls: 'text-destructive' },
  renamed: { label: 'R', cls: 'text-info' },
  copied: { label: 'C', cls: 'text-info' },
}
const lineClass = (l: string) =>
  l.startsWith('@@') ? 'bg-info/10 text-info' : l.startsWith('+') ? 'bg-success/12' : l.startsWith('-') ? 'bg-destructive/12' : ''
</script>

<template>
  <div class="space-y-2">
    <div v-for="f in files" :key="f.filename" class="overflow-hidden rounded-lg border">
      <button type="button" class="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted" @click="toggle(f.filename)">
        <PhCaretDown v-if="open.has(f.filename)" :size="12" /><PhCaretRight v-else :size="12" />
        <span :class="cn('w-3 font-mono font-semibold', STATUS[f.status]?.cls ?? 'text-warning')" :title="f.status">{{ STATUS[f.status]?.label ?? 'M' }}</span>
        <span class="min-w-0 flex-1 truncate font-mono [direction:rtl] text-left" :title="f.previousFilename ? `${f.previousFilename} → ${f.filename}` : f.filename"><bdi>{{ f.filename }}</bdi></span>
        <span class="text-success tabular-nums">+{{ f.additions }}</span>
        <span class="text-destructive tabular-nums">−{{ f.deletions }}</span>
        <a :href="f.url" target="_blank" rel="noopener" class="text-muted-foreground hover:text-foreground" aria-label="Open file on GitHub" @click.stop>
          <PhArrowSquareOut :size="13" />
        </a>
      </button>
      <template v-if="open.has(f.filename)">
        <div v-if="f.patch" class="overflow-x-auto">
          <pre class="min-w-max font-mono text-[11px] leading-[1.15rem]"><div v-for="(l, i) in f.patch.split('\n')" :key="i" :class="cn('px-3', lineClass(l))">{{ l || ' ' }}</div></pre>
        </div>
        <p v-else class="px-3 py-2 text-xs text-muted-foreground">No diff to show (binary or very large file).</p>
        <a v-if="f.patchTruncated" :href="f.url" target="_blank" rel="noopener" class="block border-t px-3 py-1.5 text-xs text-primary hover:underline">Diff shortened: see the full file on GitHub</a>
      </template>
    </div>
    <a v-if="truncated" :href="`${prUrl}/files`" target="_blank" rel="noopener" class="block text-xs text-primary hover:underline">More files changed: see them all on GitHub</a>
  </div>
</template>
