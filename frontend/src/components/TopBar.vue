<script setup lang="ts">
import { ChevronDown, LogOut, MailCheck, Menu, Plug, RefreshCw, Sparkles, Unplug } from '@lucide/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import ConnectRequiredDialog from '@/components/ConnectRequiredDialog.vue'
import SideNav from '@/components/SideNav.vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/composables/useAuth'
import { LOW_CREDITS, useCredits } from '@/composables/useCredits'
import { useHl } from '@/composables/useHl'

defineProps<{ crumb?: string }>()

const router = useRouter()
const { user, emailVerified, signOut } = useAuth()
const { credits, available } = useCredits()
const { hl, loaded, busy, connect, disconnect } = useHl()
const confirmDisconnect = ref(false)
const navOpen = ref(false)

const email = user.value?.email ?? ''

async function confirmed() {
  if (await disconnect()) confirmDisconnect.value = false
}
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-3 bg-ink-100 px-4 text-white">
    <Button variant="ghost" size="icon" class="-ml-1 text-white hover:bg-white/10 hover:text-white" aria-label="Open navigation" @click="navOpen = true">
      <Menu class="size-5" />
    </Button>
    <AppLogo inverted />
    <template v-if="crumb">
      <span class="text-white/50">/</span>
      <RouterLink to="/" class="text-[13px] text-white/70 hover:text-white">Projects</RouterLink>
      <span class="text-white/50">/</span>
      <span class="max-w-60 truncate text-[13px] font-semibold">{{ crumb }}</span>
    </template>
    <slot name="status" />
    <div class="flex-1" />
    <slot name="actions" />

    <!-- AI credits: unlocked by verifying the email address -->
    <Button
      v-if="user && !emailVerified"
      variant="ghost"
      class="h-10 gap-2 rounded-lg border border-warn-500/50 bg-white/[0.08] px-3 text-sm text-white hover:bg-white/15 hover:text-white"
      @click="router.push('/')"
    >
      <MailCheck class="size-4 text-warn-500" /><span class="hidden sm:inline">Verify email to unlock credits</span><span class="sm:hidden">Verify</span>
    </Button>
    <div
      v-else-if="credits"
      class="flex h-10 items-center gap-2 rounded-lg border bg-white/[0.08] px-3 text-white"
      :class="available < LOW_CREDITS ? 'border-warn-500/50' : 'border-white/15'"
      :title="`${available.toLocaleString()} AI credits available · ${credits.used.toLocaleString()} used`"
    >
      <Sparkles class="size-4" :class="available < LOW_CREDITS ? 'text-warn-500' : 'text-primary'" aria-hidden="true" />
      <span class="grid leading-tight">
        <span class="hidden text-[10px] font-medium uppercase tracking-wider text-white/60 sm:block">AI credits</span>
        <span class="text-sm font-semibold tabular-nums">{{ available.toLocaleString() }}</span>
      </span>
    </div>

    <!-- Connection pill: always visible, reads the shared store -->
    <DropdownMenu v-if="loaded && hl">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          class="h-10 gap-2.5 rounded-lg border border-ok-500/40 bg-white/[0.08] py-1 pl-2.5 pr-2 text-left text-white hover:bg-white/15 hover:text-white"
          aria-label="Connected HighLevel sub-account"
        >
          <span class="relative grid size-2.5 place-items-center" aria-hidden="true">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-ok-500 opacity-60" />
            <span class="relative size-2.5 rounded-full bg-ok-500" />
          </span>
          <span class="grid leading-tight">
            <span class="hidden text-[10px] font-medium uppercase tracking-wider text-white/60 sm:block">Connected sub-account</span>
            <span class="max-w-28 truncate text-sm font-semibold sm:max-w-48">{{ hl.locationName }}</span>
          </span>
          <ChevronDown class="size-4 text-white/60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-64">
        <DropdownMenuLabel class="grid gap-0.5 font-normal">
          <span class="text-xs text-muted-foreground">HighLevel location</span>
          <span class="font-semibold text-data-500">{{ hl.locationName }}</span>
          <span class="font-mono text-[11px] text-muted-foreground">{{ hl.locationId }}</span>
          <span v-if="hl.location?.timezone" class="text-xs text-muted-foreground">{{ hl.location.timezone }}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem :disabled="busy !== null" @click="connect()"><RefreshCw class="size-4" /> Reconnect</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="text-destructive focus:text-destructive" @click="confirmDisconnect = true">
          <Unplug class="size-4" /> Disconnect…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      v-else-if="loaded"
      variant="ghost"
      class="h-10 gap-2.5 rounded-lg border border-warn-500/50 bg-white/[0.08] py-1 pl-2.5 pr-3 text-left text-white hover:bg-white/15 hover:text-white"
      :disabled="busy !== null"
      @click="connect()"
    >
      <span class="size-2.5 rounded-full bg-warn-500" aria-hidden="true" />
      <span class="grid leading-tight">
        <span class="hidden text-[10px] font-medium uppercase tracking-wider text-white/60 sm:block">No sub-account connected</span>
        <span class="text-sm font-semibold">Connect HighLevel</span>
      </span>
    </Button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="rounded-full hover:bg-white/10" aria-label="Account menu">
          <Avatar class="size-7"><AvatarFallback class="bg-primary text-xs font-semibold text-primary-foreground">{{ email.charAt(0).toUpperCase() }}</AvatarFallback></Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-56">
        <DropdownMenuLabel class="truncate font-normal text-muted-foreground">{{ email }}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="signOut().then(() => router.push('/signin'))"><LogOut class="size-4" /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </header>

  <SideNav v-model:open="navOpen" />
  <ConnectRequiredDialog />

  <Dialog v-model:open="confirmDisconnect">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Disconnect {{ hl?.locationName }}?</DialogTitle>
        <DialogDescription>
          Genesis deletes the stored access and refresh tokens. Your apps and code are kept, but building and live preview
          pause until you connect again. To revoke access completely, also uninstall Genesis in HighLevel.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" @click="confirmDisconnect = false">Cancel</Button>
        <Button variant="destructive" :disabled="busy === 'disconnecting'" @click="confirmed">
          <Plug class="size-4" /> {{ busy === 'disconnecting' ? 'Disconnecting…' : 'Disconnect' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
