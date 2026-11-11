<script setup lang="ts">
import { computed } from 'vue'
import { useDeck } from '@/stores/deck'

/**
 * "owner/name" with the name kept visible: the owner (grey) gives way first, with its ellipsis on the
 * left ("…Systems-Inc/portal"). Plain text otherwise (no slash).
 */
/** Either `repo` ("owner/name", optional `suffix` kept with the name, e.g. "#123") or a PR `id` ("owner/name#123") */
const props = defineProps<{ repo?: string; suffix?: string; id?: string }>()
const deck = useDeck()
const full = computed(() => {
  if (props.id) {
    const [repo, n] = props.id.split('#')
    // PR ids are lowercase; show the repo as GitHub spells it when we have the PR
    return { repo: deck.byId.get(props.id)?.repo ?? repo, suffix: n ? `#${n}` : '' }
  }
  return { repo: props.repo ?? '', suffix: props.suffix ?? '' }
})
const parts = computed(() => {
  const r = full.value.repo
  const i = r.lastIndexOf('/')
  return i < 0 ? { owner: '', name: r } : { owner: r.slice(0, i + 1), name: r.slice(i + 1) }
})
</script>

<template>
  <span class="flex min-w-0 items-baseline" :title="full.repo + full.suffix">
    <!-- rtl moves the ellipsis to the left; bdi keeps "owner/" in its normal order -->
    <span v-if="parts.owner" class="min-w-0 truncate text-muted-foreground [direction:rtl]"><bdi>{{ parts.owner }}</bdi></span>
    <!-- Never shrinks (flex shrinks proportionally, so a shrinkable name lost a few pixels to an ellipsis);
         only truncates when the name alone is wider than the space -->
    <span class="max-w-full shrink-0 truncate">{{ parts.name }}{{ full.suffix }}</span>
  </span>
</template>
