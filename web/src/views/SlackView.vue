<script setup lang="ts">
import { computed } from 'vue'
import { PhSlackLogo } from '@phosphor-icons/vue'
import type { SlackKind, SlackStatus } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout, type SortDir } from '@/stores/layout'
import SlackRow from '@/components/SlackRow.vue'
import SortDirButton from '@/components/SortDirButton.vue'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const v = useLayout().view('slack', { status: 'new' as SlackStatus, kind: '' as SlackKind | '', dir: 'desc' as SortDir })
const all = computed(() => deck.overview?.slack ?? [])
const items = computed(() => {
  const list = all.value.filter((i) => i.status === v.status && (!v.kind || i.kind === v.kind))
  return v.dir === 'desc' ? list : [...list].reverse()
})
const STATUS_TABS: { value: SlackStatus; label: string }[] = [
  { value: 'new', label: 'Inbox' },
  { value: 'done', label: 'Done' },
  { value: 'dismissed', label: 'Dismissed' },
]
const count = (s: SlackStatus) => all.value.filter((i) => i.status === s).length
const KINDS: { value: SlackKind; label: string }[] = [
  { value: 'mention', label: '@-mentions' },
  { value: 'dm', label: 'Direct messages' },
  { value: 'group', label: 'Group DMs' },
  { value: 'saved', label: 'Saved / bookmarked' },
  { value: 'todo', label: 'Marked todo' },
]
const kindCount = (k: SlackKind) => all.value.filter((i) => i.status === v.status && i.kind === k).length
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <Alert v-if="!deck.overview?.configured.slack">
      <PhSlackLogo />
      <AlertTitle>Slack isn't connected yet</AlertTitle>
      <AlertDescription>Add a user token in Settings to pull mentions, unanswered DMs and saved items.</AlertDescription>
      <AlertAction>
        <Button size="sm" as-child><RouterLink to="/settings">Connect Slack</RouterLink></Button>
      </AlertAction>
    </Alert>
    <div class="flex flex-wrap items-center gap-2">
      <Tabs v-model="v.status">
        <TabsList>
          <TabsTrigger v-for="t in STATUS_TABS" :key="t.value" :value="t.value" :count="count(t.value)">{{ t.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <NativeSelect v-model="v.kind" size="sm">
        <NativeSelectOption value="">All sources</NativeSelectOption>
        <NativeSelectOption v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }} ({{ kindCount(k.value) }})</NativeSelectOption>
      </NativeSelect>
      <span class="flex-1" />
      <SortDirButton v-model="v.dir" desc-label="Newest first" asc-label="Oldest first" />
    </div>
    <Card class="gap-0 p-1.5">
      <SlackRow v-for="i in items" :key="i.id" :item="i" />
      <div v-if="!items.length" class="py-12 text-center text-muted-foreground">Nothing here.</div>
    </Card>
  </div>
</template>
