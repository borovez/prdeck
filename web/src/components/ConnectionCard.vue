<script setup lang="ts">
import { ref, type Component } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import FormDialog from './FormDialog.vue'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface Detail {
  label: string
  value: string
  mono?: boolean
}

/**
 * Settings card for one integration. Shows read-only details; the header action is
 * Connect (opens the form dialog) until connected, then Edit + Disconnect.
 */
const props = withDefaults(
  defineProps<{
    title: string
    icon: Component
    connected: boolean
    details?: Detail[]
    connectLabel?: string
    disconnectLabel?: string
    disconnectDescription?: string
    dialogTitle?: string
    /** Prepare the dialog's draft before it opens */
    onOpen: () => void
    onSubmit: () => Promise<boolean>
    onTest?: () => Promise<unknown>
    /** Omit to hide the disconnect button */
    onDisconnect?: () => Promise<unknown>
  }>(),
  { details: () => [], disconnectLabel: 'Disconnect' },
)
const open = ref(false)
function openDialog() {
  props.onOpen()
  open.value = true
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><component :is="icon" :size="20" /> {{ title }}</CardTitle>
      <CardDescription><slot name="description" /></CardDescription>
      <CardAction class="flex gap-2">
        <template v-if="connected">
          <Button size="sm" variant="outline" @click="openDialog">Edit</Button>
          <ConfirmDialog
            v-if="onDisconnect"
            :title="`${disconnectLabel}?`"
            :description="disconnectDescription ?? `The stored credentials for ${title} are deleted. You can connect again any time.`"
            :confirm-label="disconnectLabel"
            @confirm="onDisconnect"
          >
            <Button size="sm" variant="ghost" class="text-destructive hover:text-destructive">{{ disconnectLabel }}</Button>
          </ConfirmDialog>
        </template>
        <Button v-else size="sm" @click="openDialog">{{ connectLabel ?? `Connect ${title}` }}</Button>
      </CardAction>
    </CardHeader>

    <CardContent v-if="details.length || $slots.default" class="space-y-4">
      <dl v-if="details.length" class="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
        <template v-for="d in details" :key="d.label">
          <dt class="text-muted-foreground">{{ d.label }}</dt>
          <dd class="min-w-0 break-words" :class="{ 'font-mono text-xs leading-5': d.mono }">{{ d.value }}</dd>
        </template>
      </dl>
      <slot />
    </CardContent>

    <FormDialog v-model:open="open" :title="dialogTitle ?? (connected ? `Edit ${title}` : connectLabel ?? `Connect ${title}`)" :on-submit="onSubmit" :on-test="onTest" :submit-label="connected ? 'Save' : 'Connect'">
      <template v-if="$slots['dialog-description']" #description><slot name="dialog-description" /></template>
      <slot name="form" />
    </FormDialog>
  </Card>
</template>
