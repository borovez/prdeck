<script setup lang="ts">
import { Label } from '@/components/ui/label'

/** Form field: label above the control, optional hint below. */
defineProps<{ label: string; hint?: string }>()
</script>

<template>
  <div class="grid gap-1.5">
    <Label>{{ label }}</Label>
    <slot />
    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
  </div>
</template>
