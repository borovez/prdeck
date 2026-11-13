<script setup lang="ts">
import { computed } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import type { FilterField, Filters } from '@/components/FilterMenu.vue'

/** The active filters of a FilterMenu as chips ("Repo is any of a, b"); clicking one reopens the menu on it */
const props = defineProps<{ fields: FilterField[] }>()
const model = defineModel<Filters>({ required: true })
const emit = defineEmits<{ open: [key: string] }>()

const active = computed(() =>
  props.fields
    .filter((f) => model.value[f.key]?.length)
    .map((f) => {
      const values = model.value[f.key]
      const labels = values.map((v) => f.options.find((o) => o.value === v)?.label ?? v)
      return { field: f, values, labels, text: values.length > 2 ? `${values.length} values` : labels.join(', ') }
    }),
)
function clear(key: string) {
  const copy = { ...model.value }
  delete copy[key]
  model.value = copy
}
</script>

<template>
  <div v-for="a in active" :key="a.field.key" class="flex h-7 items-center overflow-hidden rounded-md border bg-background text-xs">
    <button type="button" class="flex h-full min-w-0 items-center gap-1.5 px-2 hover:bg-accent" :title="a.labels.join(', ')" @click="emit('open', a.field.key)">
      <component :is="a.field.icon" class="size-3.5 text-muted-foreground" />
      <span class="text-muted-foreground">{{ a.field.label }}</span>
      <span class="text-muted-foreground/70">{{ a.values.length > 1 ? 'is any of' : 'is' }}</span>
      <span class="max-w-56 truncate font-medium">{{ a.text }}</span>
    </button>
    <button
      type="button"
      class="flex h-full items-center border-l px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      :aria-label="`Remove ${a.field.label} filter`"
      @click="clear(a.field.key)"
    >
      <PhX class="size-3" />
    </button>
  </div>
</template>
