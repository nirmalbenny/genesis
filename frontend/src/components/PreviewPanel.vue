<script setup lang="ts">
import { loadSandpackClient, type SandpackClient } from '@codesandbox/sandpack-client'
import { CircleAlert, Plug, RefreshCw } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuildingOverlay from '@/components/BuildingOverlay.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FUNCTIONS_BASE } from '@/firebase'
import { api } from '@/lib/api'
import HL_CLIENT from '@/sandbox/genesis/hl.js?raw'
import UI_KIT from '@/sandbox/genesis/ui.css?raw'

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
  hideHeader?: boolean
}>()
const emit = defineEmits<{ connect: []; 'show-code': [] }>()

const iframe = ref<HTMLIFrameElement | null>(null)
const banner = ref('')
let client: SandpackClient | null = null
let token: { token: string; locationId: string; locationName?: string; expiresAt: number } | null = null
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const INDEX_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Preview</title></head><body><div id="app"></div></body></html>'
const PACKAGE_JSON = JSON.stringify({
  name: 'genesis-preview',
  main: '/src/main.js',
  dependencies: { vue: '^3.2.8', 'core-js': '^3.6.5' },
  devDependencies: { '@vue/cli-plugin-babel': '^5.0.8' },
})

async function ensureToken() {
  if (token && token.expiresAt - Date.now() > 60_000) return
  token = await api('POST', `/projects/${props.projectId}/preview-token`)
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refresh(), Math.max(token!.expiresAt - Date.now() - 60_000, 5_000))
}

/** Rebuilds the sandbox from current files + injected (never persisted) system files. */
async function refresh() {
  if (!props.connected) return
  try {
    await ensureToken()
  } catch (e) {
    banner.value = `Preview unavailable: ${(e as Error).message}`
    return
  }
  const files: Record<string, { code: string }> = {}
  for (const [path, code] of Object.entries(props.files)) files[`/${path}`] = { code }
  files['/package.json'] = { code: PACKAGE_JSON }
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
  files['/src/genesis/ui.css'] = { code: UI_KIT }
  const setup = {
    files,
    entry: '/src/main.js',
    template: 'vue-cli' as const,
    dependencies: { vue: '^3.2.8', 'core-js': '^3.6.5' },
  }
  try {
    if (client) {
      client.updateSandbox(setup)
    } else if (iframe.value) {
      client = await loadSandpackClient(iframe.value, setup, {})
      client.listen((msg) => {
        if (msg.type === 'action' && msg.action === 'show-error') banner.value = String(msg.message ?? 'Preview error')
        else if (msg.type === 'done' && !msg.compilatonError) banner.value = ''
      })
    }
  } catch (e) {
    banner.value = `Preview failed to load: ${(e as Error).message}`
  }
}

// Connecting, or switching to another sub-account, after the panel opened: drop the stale token and reload.
watch(() => [props.connected, props.locationName] as const, ([c]) => {
  if (c) {
    token = null
    banner.value = ''
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
      <Button variant="ghost" size="icon-sm" aria-label="Refresh preview" :disabled="!connected" @click="refresh()"><RefreshCw class="size-4" /></Button>
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
        <BuildingOverlay v-if="building" :file="buildingFile ?? null" :files-done="filesDone ?? 0" @show-code="emit('show-code')" />
      </Transition>
    </div>

    <div v-if="connected && banner && !building" class="absolute z-20 inset-x-2 bottom-2 flex gap-2 rounded-md bg-danger-100 px-3 py-2 text-[13px] leading-5 shadow-[0_8px_24px_rgba(24,23,28,0.10)]">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-danger-500" /><p class="min-w-0 flex-1">{{ banner }}</p>
      <Button size="xs" variant="secondary" @click="refresh()">Retry</Button>
    </div>
  </div>
</template>
