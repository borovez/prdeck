<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowCircleUp, PhArrowSquareOut, PhCircleNotch, PhDownloadSimple } from '@phosphor-icons/vue'
import { markdownToAdf } from '@shared/adf'
import { useUpdates } from '@/composables/updates'
import { timeAgo } from '@/utils/format'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import AdfView from './AdfView.vue'

/** "Update available" in the header: the release notes, and Update and restart (or a link to download) */
const { status, installing, install } = useUpdates()
const notes = computed(() => markdownToAdf(status.value?.notes ?? ''))
</script>

<template>
  <Popover v-if="status?.available">
    <PopoverTrigger as-child>
      <Button size="sm" variant="outline" class="h-8 gap-1.5 border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary">
        <PhCircleNotch v-if="installing" class="animate-spin" /><PhArrowCircleUp v-else weight="fill" />
        {{ installing ? 'Updating…' : 'Update available' }}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-96 gap-3">
      <div>
        <p class="font-medium">PR Deck {{ status.latest }} is out</p>
        <p class="text-xs text-muted-foreground">You have {{ status.current }}<template v-if="status.publishedAt"> · released {{ timeAgo(status.publishedAt) }}</template></p>
      </div>
      <ScrollArea v-if="notes.content.length" class="rounded-md border bg-muted/40 [&>[data-slot=scroll-area-viewport]]:max-h-60">
        <div class="px-3 py-2 text-sm"><AdfView :doc="notes" /></div>
      </ScrollArea>
      <p v-if="installing" class="text-xs text-muted-foreground">Pulling, installing and rebuilding; the app reloads when the new version is running. Log: {{ status.log }}</p>
      <p v-else-if="!status.canSelfUpdate && status.reason" class="text-xs text-muted-foreground">{{ status.reason }}</p>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" as="a" :href="status.url" target="_blank" rel="noopener"><PhArrowSquareOut /> Release</Button>
        <Button v-if="!status.canSelfUpdate && status.downloadUrl" size="sm" as="a" :href="status.downloadUrl" target="_blank" rel="noopener">
          <PhDownloadSimple /> Download {{ status.latest }}
        </Button>
        <Button v-if="status.canSelfUpdate" size="sm" :disabled="installing" @click="install">
          <PhCircleNotch v-if="installing" class="animate-spin" /> Update and restart
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
