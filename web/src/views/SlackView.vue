<script setup lang="ts">
import { computed } from 'vue'
import { PhSlackLogo } from '@phosphor-icons/vue'
import type { SlackKind, SlackStatus } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import SlackRow from '@/components/SlackRow.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const v = useLayout().view('slack', { status: 'new' as SlackStatus, kind: '' as SlackKind | '', newestFirst: true })
const all = computed(() => deck.overview?.slack ?? [])
const items = computed(() => {
  const list = all.value.filter((i) => i.status === v.status && (!v.kind || i.kind === v.kind))
  return v.newestFirst ? list : [...list].reverse()
})
const count = (s: SlackStatus) => all.value.filter((i) => i.status === s).length
const kindCount = (k: SlackKind) => all.value.filter((i) => i.status === v.status && i.kind === k).length
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <Alert v-if="!deck.overview?.configured.slack">
      <PhSlackLogo />
      <AlertDescription class="flex flex-wrap items-center gap-3">
        Slack isn't connected yet.
        <Button size="sm" as-child><RouterLink to="/settings">Connect Slack</RouterLink></Button>
      </AlertDescription>
    </Alert>
    <div class="flex flex-wrap items-center gap-2">
      <Tabs v-model="v.status">
        <TabsList>
          <TabsTrigger value="new">Inbox ({{ count('new') }})</TabsTrigger>
          <TabsTrigger value="done">Done ({{ count('done') }})</TabsTrigger>
          <TabsTrigger value="dismissed">Dismissed ({{ count('dismissed') }})</TabsTrigger>
        </TabsList>
      </Tabs>
      <NativeSelect v-model="v.kind" size="sm">
        <NativeSelectOption value="">All sources</NativeSelectOption>
        <NativeSelectOption value="mention">@-mentions ({{ kindCount('mention') }})</NativeSelectOption>
        <NativeSelectOption value="dm">Direct messages ({{ kindCount('dm') }})</NativeSelectOption>
        <NativeSelectOption value="group">Group DMs ({{ kindCount('group') }})</NativeSelectOption>
        <NativeSelectOption value="saved">Saved / bookmarked ({{ kindCount('saved') }})</NativeSelectOption>
        <NativeSelectOption value="todo">Marked todo ({{ kindCount('todo') }})</NativeSelectOption>
      </NativeSelect>
      <span class="flex-1" />
      <Label class="gap-2 font-normal"><Switch v-model="v.newestFirst" /> Newest first</Label>
    </div>
    <Card class="gap-0 p-1.5">
      <SlackRow v-for="i in items" :key="i.id" :item="i" @jira="deck.slackToJira = $event" />
      <div v-if="!items.length" class="py-12 text-center text-muted-foreground">Nothing here.</div>
    </Card>
  </div>
</template>
