<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner'

import {
  PhCheckCircle,
  PhInfo,
  PhCircleNotch,
  PhXCircle,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '@/lib/utils'
import { Toaster as Sonner } from 'vue-sonner'
import 'vue-sonner/style.css'

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions')
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'var(--muted)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="props.toastOptions ?? {
      classes: {
        toast: 'rounded-lg',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <PhCheckCircle class="size-4 text-success" />
    </template>
    <template #info-icon>
      <PhInfo class="size-4 text-info" />
    </template>
    <template #warning-icon>
      <PhWarning class="size-4 text-warning" />
    </template>
    <template #error-icon>
      <PhXCircle class="size-4 text-destructive" />
    </template>
    <template #loading-icon>
      <div>
        <PhCircleNotch class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <PhX class="size-4" />
    </template>
  </Sonner>
</template>
