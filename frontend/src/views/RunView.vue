<script setup lang="ts">
import { Check, ChevronDown, Pencil, Plug, RefreshCw, RefreshCcw } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useHl } from '@/composables/useHl'
import { useProject } from '@/composables/useProject'

const projectId = String(useRoute().params.id)
const router = useRouter()
const project = useProject(projectId)
const { hl, loaded, busy, error, connect } = useHl()
const preview = ref<InstanceType<typeof PreviewPanel> | null>(null)
const ready = ref(false)

onMounted(async () => {
  await project.init()
  ready.value = true
})

// Without a connected sub-account the app has no data to run on: say so, then return home.
const REDIRECT_SECONDS = 6
const secondsLeft = ref(REDIRECT_SECONDS)
let timer: ReturnType<typeof setInterval> | undefined
function stopCountdown() {
  clearInterval(timer)
  timer = undefined
}
watch([loaded, hl], ([isLoaded, connection]) => {
  stopCountdown()
  if (!isLoaded || connection) return
  secondsLeft.value = REDIRECT_SECONDS
  timer = setInterval(() => {
    if (--secondsLeft.value <= 0) {
      stopCountdown()
      router.replace('/')
    }
  }, 1000)
}, { immediate: true })
onBeforeUnmount(stopCountdown)

function connectNow() {
  stopCountdown()
  connect()
}
</script>

<template>
  <div class="flex h-screen flex-col bg-background">
    <header class="flex h-14 shrink-0 items-center gap-3 bg-ink-100 px-4 text-white">
      <AppLogo inverted />
      <span class="text-white/50">/</span>
      <span class="max-w-60 truncate text-[13px] font-semibold">{{ project.name.value }}</span>
      <div class="flex-1" />

      <!-- One HighLevel location per user: the menu shows the connected one and lets you re-authorize -->
      <DropdownMenu v-if="loaded">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            class="h-10 gap-2.5 rounded-lg border bg-white/[0.08] py-1 pl-2.5 pr-2 text-left text-white hover:bg-white/15 hover:text-white"
            :class="hl ? 'border-ok-500/40' : 'border-warn-500/50'"
            aria-label="HighLevel sub-account"
          >
            <span class="size-2.5 rounded-full" :class="hl ? 'bg-ok-500' : 'bg-warn-500'" aria-hidden="true" />
            <span class="grid leading-tight">
              <span class="hidden text-[10px] font-medium uppercase tracking-wider text-white/60 sm:block">{{ hl ? 'Connected sub-account' : 'No sub-account connected' }}</span>
              <span class="max-w-28 truncate text-sm font-semibold sm:max-w-48">{{ hl ? hl.locationName : 'Connect HighLevel' }}</span>
            </span>
            <ChevronDown class="size-4 text-white/60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-64">
          <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">HighLevel account</DropdownMenuLabel>
          <DropdownMenuItem v-if="hl" class="gap-2">
            <Check class="size-4 text-primary" />
            <span class="grid min-w-0">
              <span class="truncate font-medium">{{ hl.locationName }}</span>
              <span class="font-mono text-[11px] text-muted-foreground">{{ hl.locationId }}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="hl" />
          <DropdownMenuItem :disabled="busy !== null" @click="connect()">
            <RefreshCcw class="size-4" />{{ hl ? 'Connect a different account' : 'Connect HighLevel' }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="outline" class="h-7 gap-1.5 border-white/25 bg-white/10 text-xs text-white hover:bg-white/20 hover:text-white" :disabled="!hl" @click="preview?.refresh()">
        <RefreshCw class="size-3.5" />Refresh
      </Button>
      <Button size="sm" class="h-7 gap-1.5 text-xs" as-child>
        <RouterLink :to="`/p/${projectId}`"><Pencil class="size-3.5" />Edit</RouterLink>
      </Button>
    </header>

    <Alert v-if="error || project.loadError.value" variant="destructive" class="rounded-none border-0 bg-danger-100">
      <AlertDescription class="text-foreground">{{ error || project.loadError.value }}</AlertDescription>
    </Alert>

    <section v-if="loaded && !hl" class="grid flex-1 place-items-center p-6" role="alert">
      <div class="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <span class="mx-auto grid size-11 place-items-center rounded-lg bg-secondary text-primary"><Plug class="size-5" /></span>
        <h1 class="mt-4 text-lg font-semibold">No sub-account connected</h1>
        <p class="mt-1.5 text-sm leading-6 text-ink-200">
          This app runs on live HighLevel data, so a sub-account needs to be connected before it can launch.
        </p>
        <p class="mt-3 text-[13px] text-muted-foreground" aria-live="polite">
          Taking you home in {{ secondsLeft }} second{{ secondsLeft === 1 ? '' : 's' }}…
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" @click="router.replace('/')">Go home now</Button>
          <Button :disabled="busy !== null" @click="connectNow">{{ busy === 'connecting' ? 'Redirecting…' : 'Connect HighLevel' }}</Button>
        </div>
      </div>
    </section>

    <PreviewPanel
      v-else-if="ready"
      ref="preview"
      hide-header
      class="min-h-0 flex-1"
      :project-id="projectId"
      :files="project.files"
      :connected="!!hl"
      :location-name="hl?.locationName ?? null"
      :building="false"
      @connect="connect()"
    />
  </div>
</template>
