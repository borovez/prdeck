<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  PhDesktop,
  PhGauge,
  PhGear,
  PhGitPullRequest,
  PhGraph,
  PhRocketLaunch,
  PhKanban,
  PhMoon,
  PhSlackLogo,
  PhSun,
  PhTimer,
  PhWarning,
  PhNotePencil,
} from '@phosphor-icons/vue'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'
import { useLayout } from '@/stores/layout'
import { useTheme } from '@/composables/theme'
import { timeAgo } from '@/utils/format'
import GlobalSearch from '@/components/GlobalSearch.vue'
import SyncErrors from '@/components/SyncErrors.vue'
import SyncButton from '@/components/SyncButton.vue'
import NavUser from '@/components/NavUser.vue'
import PrDrawer from '@/components/PrDrawer.vue'
import SlackDrawer from '@/components/SlackDrawer.vue'
import JiraDrawer from '@/components/JiraDrawer.vue'
import JiraComposer from '@/components/JiraComposer.vue'
import PrWriter from '@/components/PrWriter.vue'
import { onKeyStroke } from '@vueuse/core'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Toggle } from '@/components/ui/toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const deck = useDeck()
const layout = useLayout()
const route = useRoute()
const theme = useTheme()

// C opens a new Jira issue, unless typing or a dialog is open
onKeyStroke('c', (e) => {
  const t = e.target as HTMLElement
  if (e.metaKey || e.ctrlKey || e.altKey || !deck.overview?.configured.jira || deck.composer) return
  if (t.closest('input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]')) return
  e.preventDefault()
  deck.composer = { mode: 'create' }
})

onMounted(async () => {
  await Promise.all([deck.load(), layout.load()])
  deck.startPolling()
})

const stats = computed(() => deck.overview?.stats)
const nav = computed(() => [
  { to: '/', label: 'Overview', icon: PhGauge, count: stats.value?.action },
  { to: '/prs', label: 'Pull requests', icon: PhGitPullRequest, count: deck.prs.length },
  { to: '/slack', label: 'Slack inbox', icon: PhSlackLogo, count: stats.value?.slackNew },
  { to: '/graph', label: 'Dependencies', icon: PhGraph, count: deck.overview?.chains.filter((c) => !c.done).length },
  {
    to: '/releases',
    label: 'Releases',
    icon: PhRocketLaunch,
    count: deck.prs.filter((p) => (p.flow === 'release' && p.state === 'OPEN') || (p.flow === 'hotfix' && p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged)).length,
  },
  { to: '/jira', label: 'Jira tasks', icon: PhKanban, count: deck.overview?.jira.length },
  { to: '/settings', label: 'Settings', icon: PhGear },
])
const title = computed(() => nav.value.find((n) => n.to === route.path)?.label ?? '')
const autoSync = computed(() => deck.overview?.autoSync)
const setAutoSync = (enabled: boolean) =>
  deck.mutate(
    () => api.setAutoSync(enabled),
    enabled ? `Auto-sync on, every ${autoSync.value?.intervalMinutes ?? 5} min` : 'Auto-sync off',
  )
const needsSetup = computed(() => !!deck.overview && !deck.overview.configured.github)
</script>

<template>
  <TooltipProvider :delay-duration="250">
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader class="app-titlebar app-titlebar-left">
          <div class="flex items-center gap-2 px-2 py-1.5 text-base font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <PhGitPullRequest :size="22" weight="duotone" class="shrink-0 text-primary" />
            <span class="group-data-[collapsible=icon]:hidden">PR Deck</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in nav" :key="item.to">
                  <SidebarMenuButton as-child :is-active="route.path === item.to" :tooltip="item.label">
                    <RouterLink :to="item.to">
                      <component :is="item.icon" />
                      <span>{{ item.label }}</span>
                    </RouterLink>
                  </SidebarMenuButton>
                  <SidebarMenuBadge v-if="item.count">{{ item.count }}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset class="min-w-0">
        <!-- Three columns so the search stays centred: title and sync status | search | actions -->
        <header class="app-titlebar app-titlebar-right sticky top-0 z-20 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <div class="flex min-w-0 items-center gap-2">
          <SidebarTrigger class="-ml-1" />
          <Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
          <h1 class="text-sm font-semibold">{{ title }}</h1>
          <span class="ml-2 hidden truncate text-xs text-muted-foreground lg:inline">
            <template v-if="deck.overview?.sync.lastFinishedAt">
              Synced {{ timeAgo(deck.overview.sync.lastFinishedAt) }}
              <template v-if="deck.overview.sync.counts">
                · {{ deck.overview.sync.counts.prs }} PRs · {{ deck.overview.sync.counts.jira }} issues · {{ deck.overview.sync.counts.slack ?? 0 }} Slack
              </template>
            </template>
            <template v-else-if="deck.overview">Never synced</template>
          </span>
          </div>
          <GlobalSearch />

          <div class="flex min-w-0 items-center justify-end gap-2">
          <SyncErrors />
          <Tooltip v-if="deck.overview?.configured.jira">
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="New Jira issue" @click="deck.composer = { mode: 'create' }"><PhNotePencil /></Button>
            </TooltipTrigger>
            <TooltipContent>New Jira issue <kbd class="ml-1 font-mono">C</kbd></TooltipContent>
          </Tooltip>

          <ButtonGroup>
            <SyncButton :disabled="needsSetup" />
            <Tooltip v-if="autoSync">
              <TooltipTrigger as-child>
                <Toggle size="sm" variant="outline" :model-value="autoSync.enabled" :disabled="needsSetup" aria-label="Auto-sync" @update:model-value="setAutoSync">
                  <PhTimer /> Auto
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                Auto-sync every {{ autoSync.intervalMinutes }} min is {{ autoSync.enabled ? 'on' : 'off' }}. Interval in Settings.
              </TooltipContent>
            </Tooltip>
          </ButtonGroup>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" title="Theme">
                <PhSun class="dark:hidden" /><PhMoon class="hidden dark:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup v-model="theme">
                <DropdownMenuRadioItem value="light"><PhSun /> Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark"><PhMoon /> Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="auto"><PhDesktop /> System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <main class="flex-1 bg-muted/30 p-4 lg:p-6">
          <Alert v-if="deck.error" :key="deck.error" variant="destructive" class="mb-4" closable @close="deck.error = null">
            <PhWarning />
            <AlertDescription>{{ deck.error }}</AlertDescription>
          </Alert>
          <Alert v-if="needsSetup && route.name !== 'settings'" class="mb-4">
            <PhGear />
            <AlertTitle>Finish setup</AlertTitle>
            <AlertDescription>Connect GitHub (and optionally Jira and Slack) to get started.</AlertDescription>
            <AlertAction>
              <Button size="sm" as-child><RouterLink to="/settings">Open setup</RouterLink></Button>
            </AlertAction>
          </Alert>
          <RouterView />
        </main>
      </SidebarInset>
    </SidebarProvider>
    <PrDrawer />
    <SlackDrawer />
    <JiraDrawer />
    <JiraComposer />
    <PrWriter />
    <Toaster :theme="theme === 'auto' ? 'system' : theme" position="bottom-right" close-button />
  </TooltipProvider>
</template>
