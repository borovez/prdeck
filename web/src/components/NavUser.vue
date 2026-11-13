<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowsClockwise, PhCaretUpDown, PhGear } from '@phosphor-icons/vue'
import { useDeck } from '@/stores/deck'
import { timeAgo } from '@/utils/format'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

/** Sidebar footer: who's signed in, last sync, connection status, quick actions. */
const deck = useDeck()
const router = useRouter()
const { isMobile } = useSidebar()

const login = computed(() => deck.overview?.me[0] ?? null)
const avatar = (l: string) => `https://github.com/${l}.png?size=64`
const synced = computed(() => {
  const s = deck.overview?.sync
  if (s?.running || deck.syncRunning) return 'Syncing…'
  return s?.lastFinishedAt ? `Synced ${timeAgo(s.lastFinishedAt)}` : 'Never synced'
})
const connections = computed(() => {
  const c = deck.overview?.configured
  return [
    { label: 'GitHub', on: !!c?.github },
    { label: 'Jira', on: !!c?.jira },
    { label: 'Slack', on: !!c?.slack },
    { label: 'Claude', on: !!c?.ai },
  ]
})
const errors = computed(() => deck.overview?.sync.errors.length ?? 0)
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg" class="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground" :tooltip="login ?? 'Account'">
            <Avatar class="size-8 rounded-lg">
              <AvatarImage v-if="login" :src="avatar(login)" :alt="login" />
              <AvatarFallback class="rounded-lg text-xs">{{ (login ?? '?').slice(0, 2).toUpperCase() }}</AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">{{ login ?? 'Not connected' }}</span>
              <span :class="cn('truncate text-xs', errors ? 'text-warning' : 'text-muted-foreground')">
                {{ synced }}<template v-if="errors"> · {{ errors }} error{{ errors === 1 ? '' : 's' }}</template>
              </span>
            </div>
            <PhCaretUpDown class="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-(--reka-dropdown-menu-trigger-width) min-w-60 rounded-lg" :side="isMobile ? 'bottom' : 'right'" align="end" :side-offset="4">
          <DropdownMenuLabel class="font-normal">
            <div v-for="l in deck.overview?.me ?? []" :key="l" class="flex items-center gap-2 py-0.5 text-sm">
              <Avatar class="size-6 rounded-md">
                <AvatarImage :src="avatar(l)" :alt="l" />
                <AvatarFallback class="rounded-md text-[10px]">{{ l.slice(0, 2).toUpperCase() }}</AvatarFallback>
              </Avatar>
              <span class="truncate font-medium">{{ l }}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem v-for="c in connections" :key="c.label" @select="router.push('/settings')">
              <span :class="cn('size-2 rounded-full', c.on ? 'bg-success' : 'bg-muted-foreground/40')" />
              {{ c.label }}
              <span class="ml-auto text-xs text-muted-foreground">{{ c.on ? 'Connected' : 'Set up' }}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="deck.syncRunning || !deck.overview?.configured.github" @select="deck.sync()">
            <PhArrowsClockwise :class="{ 'animate-spin': deck.syncRunning }" /> Sync now
          </DropdownMenuItem>
          <DropdownMenuItem @select="router.push('/settings')"><PhGear /> Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
