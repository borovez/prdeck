<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PrDetail, PrView } from '@shared/types'
import { descriptionExcerpt, loadPrDetail } from '@/composables/prDetail'
import { Skeleton } from '@/components/ui/skeleton'

/** Hover preview for a PR card: the start of the description and the changed files */
const props = defineProps<{ pr: PrView }>()
const detail = ref<PrDetail | null>(null)
const error = ref('')
onMounted(async () => {
  try {
    detail.value = await loadPrDetail(props.pr)
  } catch (e) {
    error.value = (e as Error).message
  }
})
const SHOWN = 8
</script>

<template>
  <div class="space-y-3 text-xs">
    <p class="text-sm leading-snug font-medium">{{ pr.title }}</p>
    <p v-if="error" class="text-destructive">{{ error }}</p>
    <template v-else-if="detail">
      <p class="leading-relaxed text-muted-foreground">{{ descriptionExcerpt(detail.bodyHTML) || 'No description.' }}</p>
      <div>
        <div class="mb-1 font-medium">{{ pr.changedFiles }} files changed</div>
        <ul class="space-y-0.5 font-mono">
          <li v-for="f in detail.files.slice(0, SHOWN)" :key="f.filename" class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-left [direction:rtl]" :title="f.filename"><bdi>{{ f.filename }}</bdi></span>
            <span class="text-success tabular-nums">+{{ f.additions }}</span>
            <span class="text-destructive tabular-nums">−{{ f.deletions }}</span>
          </li>
        </ul>
        <p v-if="pr.changedFiles > SHOWN" class="mt-1 text-muted-foreground">and {{ pr.changedFiles - SHOWN }} more: open the PR's Files tab</p>
      </div>
    </template>
    <div v-else class="space-y-2"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /><Skeleton class="h-3 w-3/5" /></div>
  </div>
</template>
