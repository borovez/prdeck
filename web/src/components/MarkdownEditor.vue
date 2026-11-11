<script setup lang="ts">
import { computed, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { PhEye, PhPencilSimple } from '@phosphor-icons/vue'
import { markdownToAdf } from '@shared/adf'
import { useLayout } from '@/stores/layout'
import AdfView from './AdfView.vue'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

/** Markdown field with Write / Preview tabs. The preview shows the same Jira document the server sends. */
defineProps<{ label: string }>()
const model = defineModel<string>({ required: true })
const v = useLayout().view('markdown-editor', { tab: 'write' as 'write' | 'preview' })
const doc = computed(() => markdownToAdf(model.value))

// Write and Preview share one height (including after you drag-resize the textarea), so switching doesn't jump
const height = ref(288)
const textarea = ref<{ $el: HTMLElement } | null>(null)
useResizeObserver(
  () => textarea.value?.$el,
  ([entry]) => {
    const h = (entry.target as HTMLElement).offsetHeight
    if (h) height.value = h
  },
)
</script>

<template>
  <Tabs v-model="v.tab" class="gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <Label>{{ label }}</Label>
      <TabsList class="h-8">
        <TabsTrigger value="write" class="px-2.5 text-xs"><PhPencilSimple /> Write</TabsTrigger>
        <TabsTrigger value="preview" class="px-2.5 text-xs"><PhEye /> Preview</TabsTrigger>
      </TabsList>
    </div>
    <TabsContent value="write">
      <Textarea ref="textarea" v-model="model" class="field-sizing-fixed resize-y font-mono text-xs" :style="{ height: `${height}px` }" />
    </TabsContent>
    <TabsContent value="preview">
      <div class="overflow-y-auto rounded-md border bg-background px-4 py-3" :style="{ height: `${height}px` }">
        <AdfView v-if="doc.content.length" :doc="doc" />
        <p v-else class="text-sm text-muted-foreground">Nothing to preview.</p>
      </div>
    </TabsContent>
  </Tabs>
</template>
