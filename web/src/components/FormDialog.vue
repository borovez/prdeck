<script setup lang="ts">
import { ref } from 'vue'
import { PhCircleNotch } from '@phosphor-icons/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Dialog with a form body. `onSubmit` resolves to whether it worked; the dialog closes only then.
 * `onTest` (optional) adds a "Test connection" button.
 */
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    submitLabel?: string
    onSubmit: () => Promise<boolean>
    onTest?: () => Promise<unknown>
  }>(),
  { submitLabel: 'Save' },
)
const open = defineModel<boolean>('open', { default: false })
const busy = ref<'' | 'submit' | 'test'>('')

async function step(kind: 'submit' | 'test') {
  busy.value = kind
  try {
    if (kind === 'test') await props.onTest?.()
    else if (await props.onSubmit()) open.value = false
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <form class="grid gap-6" @submit.prevent="step('submit')">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription v-if="description || $slots.description">
            <slot name="description">{{ description }}</slot>
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-4">
          <slot />
        </div>
        <DialogFooter>
          <Button v-if="onTest" type="button" variant="outline" class="sm:mr-auto" :disabled="!!busy" @click="step('test')">
            <PhCircleNotch v-if="busy === 'test'" class="animate-spin" /> Test connection
          </Button>
          <Button type="button" variant="ghost" :disabled="!!busy" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="!!busy">
            <PhCircleNotch v-if="busy === 'submit'" class="animate-spin" /> {{ submitLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
