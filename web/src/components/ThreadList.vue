<script setup lang="ts">
import { PhArrowSquareOut, PhChatCircle, PhFileCode } from '@phosphor-icons/vue'
import type { ReviewThread } from '@shared/types'
import { timeAgo } from '@/utils/format'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

/** Unresolved review conversations; each links to its comment on GitHub. */
defineProps<{ threads: ReviewThread[] }>()
</script>

<template>
  <div class="space-y-2">
    <a
      v-for="t in threads"
      :key="t.url"
      :href="t.url"
      target="_blank"
      rel="noopener"
      class="group block rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-accent"
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <PhFileCode :size="14" class="shrink-0" />
        <span class="truncate font-mono text-foreground/80" :title="t.path">{{ t.path }}<template v-if="t.line">:{{ t.line }}</template></span>
        <Badge v-if="t.outdated" variant="muted" class="h-4 px-1.5 text-[10px]">outdated</Badge>
        <span class="flex-1" />
        <PhArrowSquareOut :size="14" class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div class="mt-2 flex items-start gap-2">
        <Avatar class="size-5 shrink-0">
          <AvatarImage :src="t.author.avatarUrl ?? ''" :alt="t.author.login" />
          <AvatarFallback class="text-[9px]">{{ t.author.login.slice(0, 2).toUpperCase() }}</AvatarFallback>
        </Avatar>
        <div class="min-w-0 flex-1">
          <div class="text-xs"><span class="font-medium">{{ t.author.login }}</span> <span class="text-muted-foreground">{{ timeAgo(t.createdAt) }}</span></div>
          <p class="mt-0.5 line-clamp-4 whitespace-pre-line">{{ t.body || '(no text)' }}</p>
        </div>
      </div>
      <div v-if="t.comments > 1" class="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <PhChatCircle :size="13" />{{ t.comments - 1 }} {{ t.comments === 2 ? 'reply' : 'replies' }}<template v-if="t.lastAuthor"> · last by {{ t.lastAuthor }} {{ timeAgo(t.lastAt) }}</template>
      </div>
    </a>
  </div>
</template>
