<script setup lang="ts">
import { loadSandpackClient, type SandpackClient } from '@codesandbox/sandpack-client'
import { CircleAlert, LoaderCircle, Plug, RefreshCw, Sparkles } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuildingOverlay from '@/components/BuildingOverlay.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FUNCTIONS_BASE } from '@/firebase'
import { api } from '@/lib/api'
import { clientRegistry } from '@/lib/registry'
import HL_CLIENT from '@/sandbox/genesis/hl.js?raw'
import UI_KIT from '@/sandbox/genesis/ui.css?raw'
import THEME from '@/sandbox/genesis/theme.css?raw'
import SETUP from '@/sandbox/genesis/setup.js?raw'
import { packagesFor } from '@/lib/previewPackages'

// Components for generated apps (shadcn's API, styled by the kit), injected as src/genesis/ui/*.
const UI_COMPONENTS = import.meta.glob('@/sandbox/genesis/ui/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const props = defineProps<{
  projectId: string
  files: Record<string, string>
  connected: boolean
  locationName: string | null
  /** True while a build is running: shows the signal progress line. */
  building: boolean
  /** File currently being written and how many are finished, shown in the building overlay. */
  buildingFile?: string | null
  filesDone?: number
  /** Files the model is reading before it writes, shown in the building overlay. */
  buildingReading?: string[]
  /** The build finished and the new version is loading: the overlay stays until it runs. */
  starting?: boolean
  /** Offer "Fix with AI" on a preview error (the workspace, not the full-screen app). */
  canFix?: boolean
  hideHeader?: boolean
}>()
const emit = defineEmits<{ connect: []; 'show-code': []; fix: [error: string] }>()

const iframe = ref<HTMLIFrameElement | null>(null)
const banner = ref('')
/** The preview's error with where it happened, for "Fix with AI" (empty when the banner isn't a code error). */
const codeError = ref('')
let client: SandpackClient | null = null
let token: { token: string; locationId: string; locationName?: string; expiresAt: number } | null = null
let refreshTimer: ReturnType<typeof setTimeout> | undefined

// Inter, the kit's font, as Genesis itself uses it (the kit falls back to the system font if this is blocked).
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap'
const INDEX_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Preview</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="${FONTS}" /></head><body><div id="app"></div></body></html>`
const BASE_DEPENDENCIES = { vue: '^3.4.0', 'core-js': '^3.6.5' }
// The dialog, menu, select, popover, tooltip, tabs, checkbox and switch components are built on reka-ui.
// Only apps that import the components load it, so older apps (kit classes only) don't pay for it.
const UI_DEPENDENCIES = { 'reka-ui': '^2.11.0' }
const usesComponents = (files: Record<string, string>) => Object.values(files).some((code) => /genesis\/ui(\/|["'])/.test(code))

async function ensureToken() {
  if (token && token.expiresAt - Date.now() > 60_000) return
  token = await api('POST', `/projects/${props.projectId}/preview-token`)
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refresh(), Math.max(token!.expiresAt - Date.now() - 60_000, 5_000))
}

// Refreshes run one at a time (queue): each sends the files current when its turn comes and waits until the sandbox
// has run them, so there is only ever one Sandpack client and every "done" belongs to the refresh that sent the
// files. Before, a refresh during the first load (a build finishing early, on a slow connection) created a second
// client on the same frame, and the first client's "done" lifted the overlay over the old version.
const RUN_TIMEOUT_MS = 15_000
const ERROR_GRACE_MS = 1_500 // after an error, how long to wait for the run's "done" before treating it as finished
let queue: Promise<void> = Promise.resolve()
let queued = 0
let lastSent = ''
let lastFiles = ''
/** A change is on its way to the preview (queued or sent, not yet run): shows the "Updating preview" overlay. */
const updating = ref(false)
let settle: (() => void) | null = null
let runId = 0

/** Handles the sandbox's messages: errors for the banner, and the end of the current run. */
function onMessage(msg: Parameters<Parameters<SandpackClient['listen']>[0]>[0]) {
  if (msg.type === 'action' && msg.action === 'show-error') {
    const m = msg as unknown as { title?: string; message?: string; path?: string; line?: number }
    banner.value = String(m.message ?? 'Preview error')
    const where = m.path ? ` (in ${m.path.replace(/^\//, '')}${m.line ? `, line ${m.line}` : ''})` : ''
    codeError.value = `${m.title ? `${m.title}: ` : ''}${m.message ?? ''}${where}`.trim()
    const id = runId
    setTimeout(() => { if (id === runId) settle?.() }, ERROR_GRACE_MS)
  } else if (msg.type === 'done') {
    if (!msg.compilatonError) { banner.value = ''; codeError.value = '' }
    settle?.()
  }
}

/** Sends the current files (or nothing, when unchanged) and resolves once the sandbox has run them. */
async function send(force: boolean) {
  if (!props.connected) return
  try {
    await ensureToken()
  } catch (e) {
    banner.value = `Preview unavailable: ${(e as Error).message}`
    return
  }
  const files: Record<string, { code: string }> = {}
  for (const [path, code] of Object.entries(props.files)) files[`/${path}`] = { code }
  // npm packages the app imports, directly or through the injected setup file (Element Plus), at pinned versions.
  const sources = Object.values(props.files)
  if (sources.some((code) => /genesis\/setup(\.js)?["']/.test(code))) sources.push(SETUP)
  const dependencies = { ...BASE_DEPENDENCIES, ...(usesComponents(props.files) ? UI_DEPENDENCIES : {}), ...packagesFor(sources) }
  files['/package.json'] = {
    code: JSON.stringify({ name: 'genesis-preview', main: '/src/main.js', dependencies, devDependencies: { '@vue/cli-plugin-babel': '^5.0.8' } }),
  }
  files['/public/index.html'] = { code: INDEX_HTML }
  files['/src/hl.config.js'] = {
    code: [
      `export const HL_PROXY = ${JSON.stringify(`${FUNCTIONS_BASE}/hlProxy`)}`,
      `export const PREVIEW_TOKEN = ${JSON.stringify(token!.token)}`,
      `export const LOCATION_ID = ${JSON.stringify(token!.locationId)}`,
      `export const LOCATION_NAME = ${JSON.stringify(token!.locationName ?? '')}`,
      '',
    ].join('\n'),
  }
  // The shared HighLevel client and UI kit (src/genesis/ is reserved: the model can't write there).
  files['/src/genesis/hl.js'] = { code: HL_CLIENT }
  // The endpoints the client can call (lists and call()), from the resource registry.
  files['/src/genesis/hl.registry.js'] = { code: `export default ${JSON.stringify(clientRegistry())}\n` }
  files['/src/genesis/ui.css'] = { code: UI_KIT }
  // Element Plus with Genesis's design standard, set up once for apps whose main.js is mountApp(App).
  files['/src/genesis/setup.js'] = { code: SETUP }
  files['/src/genesis/theme.css'] = { code: THEME }
  for (const [path, code] of Object.entries(UI_COMPONENTS)) files[`/src/genesis/ui/${path.split('/').pop()}`] = { code }
  const setup = {
    files,
    entry: '/src/main.js',
    template: 'vue-cli' as const,
    dependencies,
  }
  const key = JSON.stringify(setup)
  if (client && key === lastSent && !force) return
  lastSent = key
  lastFiles = JSON.stringify(props.files)
  runId++
  const ran = new Promise<void>((resolve) => {
    const timer = setTimeout(() => { settle = null; resolve() }, RUN_TIMEOUT_MS)
    settle = () => { clearTimeout(timer); settle = null; resolve() }
  })
  try {
    if (client) {
      client.updateSandbox(setup)
    } else if (iframe.value) {
      client = await loadSandpackClient(iframe.value, setup, {})
      client.listen(onMessage)
    } else {
      settle?.()
    }
  } catch (e) {
    banner.value = `Preview failed to load: ${(e as Error).message}`
    codeError.value = ''
    settle?.()
  }
  await ran
}

/**
 * Rebuilds the sandbox from current files + injected (never persisted) system files, and resolves once it has run
 * them (or failed, or after 15 s), so a caller can keep a loading state up until the new version shows. Unchanged
 * files aren't sent again unless `force` (the Refresh button, which reloads live data).
 */
function refresh({ force = false } = {}): Promise<void> {
  // The overlay shows for changes to the app's own files (and the Refresh button), not for a renewed preview token.
  if (props.connected && (force || JSON.stringify(props.files) !== lastFiles)) updating.value = true
  queued++
  queue = queue.then(() => send(force)).catch(() => {}).finally(() => {
    if (--queued === 0) updating.value = false
  })
  return queue
}

// Connecting, or switching to another sub-account, after the panel opened: drop the stale token and reload.
watch(() => [props.connected, props.locationName] as const, ([c]) => {
  if (c) {
    token = null
    banner.value = ''
    codeError.value = ''
    refresh()
  } else {
    clearTimeout(refreshTimer)
  }
})

onMounted(refresh)
onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
  client?.destroy()
})
defineExpose({ refresh })
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <div v-if="!hideHeader" class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium">
      <Badge v-if="connected && !banner" variant="secondary" class="border-transparent bg-data-100 text-data-500">
        <span class="size-[7px] rounded-full bg-data-500" />Live data<template v-if="locationName"> · {{ locationName }}</template>
      </Badge>
      <span class="flex-1" />
      <Button variant="ghost" size="icon-sm" aria-label="Refresh preview" :disabled="!connected" @click="refresh({ force: true })"><RefreshCw class="size-4" /></Button>
    </div>
    <div class="h-0.5 shrink-0 bg-signal-100"><div v-if="building" class="h-0.5 w-full bg-signal-500" /></div>

    <div v-if="!connected" class="grid flex-1 place-items-center p-8 text-center">
      <div class="grid max-w-xs justify-items-center gap-3">
        <span class="grid size-10 place-items-center rounded-lg bg-data-100 text-data-500"><Plug class="size-5" /></span>
        <p class="text-sm font-semibold">Preview needs HighLevel</p>
        <p class="text-[13px] leading-5 text-muted-foreground">Connect a location to load real contacts, conversations and appointments here.</p>
        <Button @click="emit('connect')">Connect HighLevel</Button>
      </div>
    </div>
    <div v-show="connected" class="relative flex min-h-0 flex-1 flex-col">
      <iframe ref="iframe" class="min-h-0 w-full flex-1 bg-white" title="Live preview" allow="local-network-access; local-network; loopback-network" />
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-300"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <BuildingOverlay v-if="building" :file="buildingFile ?? null" :files-done="filesDone ?? 0" :reading="buildingReading" :starting="starting" @show-code="emit('show-code')" />
      </Transition>
      <Transition
        enter-active-class="transition-opacity duration-150"
        leave-active-class="transition-opacity duration-300"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div v-if="updating && !building" class="absolute inset-0 z-10 grid place-items-center bg-background/60 backdrop-blur-[1px]" role="status" aria-live="polite">
          <p class="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-[13px] font-medium shadow-[0_8px_24px_rgba(33,51,67,0.10)]">
            <LoaderCircle class="size-4 animate-spin text-primary" aria-hidden="true" />Updating preview
          </p>
        </div>
      </Transition>
    </div>

    <div v-if="connected && banner && !building" class="absolute z-20 inset-x-2 bottom-2 flex gap-2 rounded-md bg-danger-100 px-3 py-2 text-[13px] leading-5 shadow-[0_8px_24px_rgba(24,23,28,0.10)]">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-danger-500" /><p class="min-w-0 flex-1 break-words">{{ banner }}</p>
      <Button v-if="canFix && codeError" size="xs" @click="emit('fix', codeError)"><Sparkles class="size-3.5" />Fix with AI</Button>
      <Button size="xs" variant="secondary" @click="refresh({ force: true })">Retry</Button>
    </div>
  </div>
</template>
