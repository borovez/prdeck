<script setup lang="ts">
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowClockwise, PhCheck, PhCopy, PhRobot } from '@phosphor-icons/vue'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

/**
 * The implementation prompt for a Jira issue, to paste into any AI agent: links to the issue, its parent
 * and related issues, PRs, repos, flags, Slack threads and comments, plus how to work. Editable before copying.
 */
const props = defineProps<{ issueKey: string }>()
const open = defineModel<boolean>('open', { required: true })

const prompt = ref('')
const loading = ref(false)
const copied = ref(false)

async function load() {
  loading.value = true
  copied.value = false
  try {
    prompt.value = (await api.jiraAgentPrompt(props.issueKey)).prompt
  } catch (e) {
    toast.error((e as Error).message)
  } finally {
    loading.value = false
  }
}
watch(open, (o) => o && load())

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt.value)
    copied.value = true
    toast.success('Prompt copied', { description: 'Paste it into your AI agent.' })
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    toast.error('Copy failed: select the text and copy it')
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[85vh] flex-col sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2"><PhRobot class="text-primary" /> Prompt for an AI agent</DialogTitle>
        <DialogDescription>
          Everything an agent needs to implement {{ issueKey }}, with links to the issue, its PRs and repos. Edit it here if you like, then copy.
        </DialogDescription>
      </DialogHeader>
      <Skeleton v-if="loading" class="min-h-0 flex-1" />
      <Textarea v-else v-model="prompt" spellcheck="false" class="field-sizing-fixed min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed" />
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">{{ prompt.split('\n').length }} lines · {{ prompt.length.toLocaleString() }} characters</span>
        <span class="flex-1" />
        <Button variant="ghost" size="sm" :disabled="loading" title="Build it again from the latest data" @click="load"><PhArrowClockwise /> Rebuild</Button>
        <Button size="sm" :disabled="loading || !prompt" @click="copy">
          <PhCheck v-if="copied" /><PhCopy v-else /> {{ copied ? 'Copied' : 'Copy prompt' }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
