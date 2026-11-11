<script setup lang="ts">
/** Sticky toolbar pinned to the bottom of a page: status/info on the left (default slot), buttons on the right (#actions). */
</script>

<template>
  <div class="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-popover/90 px-4 py-2.5 text-sm text-popover-foreground shadow-lg backdrop-blur">
    <div class="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
      <slot />
    </div>
    <div class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
