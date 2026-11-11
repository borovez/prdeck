<script setup lang="ts">
import { computed } from 'vue'

/**
 * "owner/name" with the name kept visible: the owner (grey) gives way first, with its ellipsis on the
 * left ("…Systems-Inc/portal"). Plain text otherwise (no slash).
 */
const props = defineProps<{ repo: string }>()
const parts = computed(() => {
  const i = props.repo.lastIndexOf('/')
  return i < 0 ? { owner: '', name: props.repo } : { owner: props.repo.slice(0, i + 1), name: props.repo.slice(i + 1) }
})
</script>

<template>
  <span class="flex min-w-0 items-baseline" :title="repo">
    <!-- rtl moves the ellipsis to the left; bdi keeps "owner/" in its normal order -->
    <span v-if="parts.owner" class="min-w-0 truncate text-muted-foreground [direction:rtl]"><bdi>{{ parts.owner }}</bdi></span>
    <!-- Never shrinks (flex shrinks proportionally, so a shrinkable name lost a few pixels to an ellipsis);
         only truncates when the name alone is wider than the space -->
    <span class="max-w-full shrink-0 truncate">{{ parts.name }}</span>
  </span>
</template>
